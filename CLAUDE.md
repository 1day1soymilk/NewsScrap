# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal Naver-news keyword graph. A Supabase Edge Function scrapes six Naver
news sections daily, extracts Korean nouns with a morphological analyser running
inside the function itself, and stores them in Postgres. A Vite + React frontend reads that data and renders a
d3-force graph filterable by date and category: words that share headlines are
joined by an edge, size stays proportional to headline count, and clicking a word
dims everything outside its neighbourhood and lists the headlines it came from.

## Commands

```bash
npm run dev            # Vite dev server
npm run build          # tsc -b (all four projects) then vite build
npm test               # full Vitest suite
npm run test:e2e       # Playwright suite (Chromium, boots the dev server itself)
npm run lint           # oxlint

npx vitest run src/lib/queries.test.ts    # one test file
npx vitest run -t "deduplicates"          # one test by name
npx tsc -b --force                        # type check only, ignoring build cache
```

`npm run build` is the real gate — it type-checks `src`, `vite.config.ts`, **and**
the runtime-agnostic Edge Function helpers. Run it before claiming a task is done;
`npm test` alone passes on code that does not compile, because Vitest transpiles
without type checking.

### Supabase

Deployment steps, verification queries, and the pg_cron setup live in
`docs/DEPLOYMENT.md`. The CLI needs credentials from the git-ignored env files:

```bash
set -a && . ./.env.supabase && set +a   # SUPABASE_ACCESS_TOKEN, _PROJECT_REF, _DB_PASSWORD
npx supabase db push --password "$SUPABASE_DB_PASSWORD"
npx supabase functions deploy collect-headlines --project-ref "$SUPABASE_PROJECT_REF"
npx supabase secrets set --env-file .env.functions --project-ref "$SUPABASE_PROJECT_REF"
```

Arbitrary SQL against the deployed database goes through the Management API
(`POST https://api.supabase.com/v1/projects/{ref}/database/query`) — there is no
local Postgres, Docker, or Deno in this environment.

## Environment files

Three, all git-ignored, all holding different credentials. None of them travel
with the repo, so a fresh clone needs them recreated.

| File | Holds | Used by |
| --- | --- | --- |
| `.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | the frontend, at build time, and `e2e/smoke.spec.ts` |
| `.env.functions` | **nothing** — see below | uploaded wholesale as the Edge Function environment |
| `.env.supabase` | CLI access token, project ref, DB password | the Supabase CLI |

`.env.functions` sets **no variables at all** now. It held `ETRI_API_KEY` until
the analyser moved inside the function, and the key is kept there commented out
because that file is the only copy of it there has ever been — it was once lost
with a deleted worktree and recovered by luck. The deployed secret was removed
with `supabase secrets unset`, which is not what `secrets set --env-file` on an
emptied file does: setting nothing removes nothing.

Never put `SUPABASE_*` variables in `.env.functions`: that file becomes the
function's environment and Supabase reserves the prefix. The DB password is not
recoverable from the dashboard — `.env.supabase` is the only copy.

Any host serving the built frontend (Vercel and the like) needs
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured there. They are baked
in at build time, and `.env` is not in the repo.

`index.html` is one of the places they are baked into: it carries
`<link rel="preconnect" href="%VITE_SUPABASE_URL%">` so the DNS, TCP and TLS to
the API host finish while the HTML is still parsing rather than after React has
mounted — everything on the first screen comes from that origin. Vite performs
the `%VITE_*%` substitution at build time, so a build with no `.env` ships the
literal placeholder in the markup. That is harmless (the app is already pointing
at a placeholder URL by then) but it is the signal that the build had no
environment.

## Architecture

### Two runtimes, one rule

`supabase/functions/collect-headlines/` is split deliberately:

- `lib/*.ts` — pure, runtime-agnostic. **No `Deno.env`, no `npm:` specifiers, no
  Deno globals.** This is what makes them testable under Vitest on Node, and it
  is why `callEtriMorphAnalysis` takes the API key as a parameter instead of
  reading it from the environment.
- `index.ts` — Deno-only orchestration (`Deno.serve`, `Deno.env`, `npm:` imports).
  Not unit-tested and **not type-checked** (tsc cannot resolve Deno globals). Its
  correctness is established by running the deployed function and reading the
  `summary` in the response.

Keep logic worth testing on the `lib/` side of that line.

### TypeScript projects

`tsconfig.json` references four projects: `app` (`src`), `node`
(`vite.config.ts`), `functions` (`supabase/functions/**/lib/**`), and `e2e`. Test files
are inside the checked scope on purpose — jest-dom matchers resolve through
`"types": [..., "@testing-library/jest-dom/vitest"]` in `tsconfig.app.json`.

Do not make a build pass by excluding tests from type checking, loosening
`tsconfig`, or weakening an assertion. That has been tried here and it hides real
errors.

### The schema lives in three places

`supabase/migrations/*.sql`, the Edge Function's inserts, and `src/lib/queries.ts`
all encode the same column names. Changing one means changing all three.

The frontend never aggregates in the client and never reads raw rows for counts —
it queries the `keyword_graph` RPC and the `collected_dates` view, which exist so
PostgREST's 1000-row cap cannot silently truncate a result set. `daily_word_counts`
is no longer on the graph's path.

**`daily_word_counts` is not exempt from that cap**, and an earlier version of this
file said it was. A day holds 3,051 distinct words (2026-08-01; 2,484 on 07-31), so
an unfiltered read of it returns the top 1,000 and nothing says so. The surge
comparison was written against that mistake and measured: summing the truncated
response for a denominator inflated every ratio by 11% and turned 12 of the 110
drawn words into false "new"s. Two rules follow, and `fetchWordCountsFor` /
`fetchHeadlineCount` in `src/lib/queries.ts` exist to enforce them:

- **Name the words you want** (`.in('word', …)`). The graph draws at most
  `render_cap` (70) of them, so a response bounded by that list cannot be cut.
- **Never sum a response to get a denominator.** Day totals are counted by
  Postgres and read as a number. `computeSurges` takes the total as an argument
  rather than summing the counts it was handed, so the mistake cannot recur by
  accident.

Those totals now ride along on `collected_dates` (migration `0011`), which the
date picker reads once per load anyway — `fetchCollectedDates` returns
`{date, headlines}[]` and `App.tsx` derives both the `string[]` the date stepper
wants and a `Map` of denominators. That is still not a summed response: the
column is `count(*)` grouped by day. **`fetchHeadlineCount` survives as the
fallback** for a date the view did not return, because `collected_dates` is one
row per collected day and so is itself subject to the 1,000-row cap — about 2.7
years out. Being truncated then costs one `head: true, count: 'exact'` request
instead of producing a wrong ratio for every word on screen. Measured cold load:
9 requests → 7, with no `HEAD` among them.

`fetchWordCounts` (the whole-day read) is still exported and tested but nothing
calls it; it is the one function here that can be silently truncated.

`daily_word_counts` is a `UNION ALL` of a per-category aggregate and an
all-categories rollup keyed by a null `category_slug`. **Do not rewrite it with
`GROUP BY GROUPING SETS`** — that form blocks predicate pushdown, so the planner
aggregates the entire history before applying the date filter. Migration
`0002_word_counts_pushdown.sql` explains the measurements.

### Word scoring and the keyword graph

`keyword_graph(p_date, p_category)` is an RPC rather than a view because the node
and edge cuts and the NPMI arithmetic have to happen server side — a day's word
pairs run to thousands of rows even after grouping, and PostgREST would truncate
at 1000. It returns `{nodes, edges}` as JSON. SQL functions default to
`SECURITY INVOKER`, so the select-only policies still apply; `anon` needs
`execute` on both it and `keyword_signals`.

`keyword_signals(p_date)` computes the five per-word signals and is called by
both the RPC and `scripts/analysis/`. **Do not reimplement those formulas** —
tuning that measures a hand-copied second copy is measuring the wrong thing, the
same hazard as the rule above.

`render_cap` is **70, and it is a display cap rather than a sieve threshold** —
it does not decide which words qualify, only how many of the ranked survivors are
drawn, so changing it does not go through `10_sieve_eval.sql`. It was 130, and
ranks 71 to 130 arrived faded at the minimum font size and sat in every gap
between the words worth reading. At 70 the drawn set is exactly the set the
harness measures. With it equal to `node_limit`, `faded` can now only mean a
`word_overrides` 'demote' entry.

Word selection is a **sieve** (thresholds in series), not a weighted score.
Blending the signals measurably makes it worse: each one catches a different kind
of bad word, and averaging dilutes each where it is strong.

Ranking is by frequency, and **`demote_head_pos` is the single exception**, added
by migration `0015`. A word that trails its headlines sorts below every word that
leads one, so it falls out only where the render cap is binding. Size is
untouched and stays proportional to headline count; what moves is which words
fill the last places under the cap. Why it is a demotion rather than a sixth
sieve clause is measured, and is the entry below.

Thresholds live in `scoring_weights` and the dictionary in `word_overrides`
(`exclude` / `demote` / `allow`), so retuning needs no redeploy. **Never change a
threshold without running `scripts/analysis/10_sieve_eval.sql` first** (or
`11_category_eval.sql` when the question is about a category tab) — its README
records five ways this has already gone wrong. Note that the labels go stale when
the *data* moves and not only when the sweep widens: collecting a date twice put
13 unlabelled words on screen and silently invalidated a run. Two findings that cost real
time and should not be rediscovered:

- **A word is rescued for being a proper noun** (`min_proper` 0.50, migration
  `0018`), and this is the largest single measured gain the sieve has had:
  **+2.9 mean F1 and +3.9 precision day-wide, +11.4 mean F1 across the 24
  category cells**, winning on all four days and never dropping the day's
  biggest story. `proper` is the share of a word's rows the analyser tagged NNP.

  **What it buys is the price of `min_word_len`, which had only ever been priced
  in one direction.** The length clause was measured as the sieve — it admits
  most of what is drawn and its precision is the whole sieve's — but nobody had
  costed what it *rejects*: a two-character word could not reach the canvas at
  all, and in the archive's whole history exactly two ever had, 폭염 and 양산,
  both by hand. 이란, 미국, 중국, 일본, 북한, 한국, 서울, 부산, 대구, 인천, 삼성,
  애플, 구글 and 기아 were all cut with the noise. 13 to 21 words a day come in
  through this clause now.

  **Length was always a proxy, and the analyser answers the real question.**
  garu tags 이란 NNP and 감찰 NNG — and 감찰, 윤리, 청문, 초등 and 순회 are
  precisely the five words named just below as the reason the specificity clause
  had to be turned off, every one scoring a perfect 1.00 on spec. The
  discrimination `spec` could not make is in the tagger's output.

  **`min_word_len 2` is the control and it is why this is the tagger's win, not
  length's**: admitting every two-character word scores mean F1 **31.98** against
  the shipped sieve's 49.48 — far worse, not better. Of the 44 words a blanket
  `min_word_len 2` promotes, 8 are good; of the 36 the tagger promotes on the
  tabs, **31** are.

  **It has the opposite signature to `head_pos`, and that is the general
  lesson.** head_pos won day-wide and lost 8 of 24 category cells while winning
  none, because it is a *cut* and a tab's render cap never binds, so there was
  nothing to promote into the hole. This is a *rescue*: it only ever adds words,
  a tab has the room, and so the tabs gain more than the day does. **A day-wide
  win with a category loss means the mechanism needs the cap to be binding; a
  win on both, larger on the tabs, means it does not.**

  0.50 is **mid-plateau and deliberately not the best cell** — .25/.50/.75/1.00
  give 52.15/52.40/52.40/52.55 day-wide and 66.28/66.44/66.48/66.37 on the tabs.
  1.00 scores 0.15 higher and is the boundary: it demands every row be tagged
  NNP, so one mistagged row in fifty disqualifies a name.

  It does **not** replace the dictionary. With `word_overrides` off the rescue
  alone scores about what the shipped sieve scores with it on — so it is not
  merely re-catching the same words — but that configuration still drops the
  day's biggest story on three of four days, because 폭염 is two characters and
  **NNG**, and lives on its `allow` entry.

  The cost is visible and was accepted on the numbers: 닉스 (from 삼전닉스) and
  어스 (from 구글 어스) are tagged NNP and come in as fragments, and 유럽, 남미,
  중동, 호남 come in as regions.
- **The rescue gave the fragment cut new work, and `min_standalone` moved from
  0.10 to 0.50 because of it** (migration `0019`). Round four had swept .05 to
  .30, found them identical and recorded 0.10 as mid-plateau — a measurement
  taken when **nothing under three characters could reach the canvas**, so the
  cut only ever saw long words, which are rarely fragments. The rescue admits on
  the tagger's say-so at any length, and the tagger has no opinion about whether
  a string is part of something bigger. Re-swept: 52.40 / 52.87 / **53.12** /
  52.55 day-wide at .10 / .30 / .50 / .70 and 66.44 → **67.02** on the tabs.
  Wins on both, and the peak is interior.

  Ten words leave the screen: seven bad (닉스 twice, 수도권, 최고위원, 경찰관,
  한국 twice) and three good — 우크라, 충청, 해남, which are the **조사 blind
  spot**, Korean attaching a particle with no space so 해남에 scores as a
  fragment. Round four's instruction not to build a particle-aware variant still
  stands; this moves a number, which the harness can price, rather than adding a
  rule it cannot.

  **The general point is worth more than the threshold**: a measurement is only
  valid under the circumstance it was taken in, and adding a clause that admits
  a *new kind* of word invalidates every threshold that was tuned when that kind
  could not appear.
- **`demote_head_pos` moved 0.70 → 0.60 for the same reason** (migration
  `0020`), which is the third threshold the rescue invalidated and the point at
  which the pattern became the finding rather than any one number. Re-swept:
  53.30 / 54.12 / 54.10 / **54.18** / 53.02 / 51.40 at .50 / .55 / .60 / .65 /
  .70 / off. 0.55–0.65 are one plateau, flat to within 0.08 and all about a
  point of F1 and two of precision above 0.70.

  **0.50 scores well and is rejected outright**, because it sinks 폭염 off
  2026-07-31's screen — the cliff round six had already recorded, still exactly
  where it was. What moved was the plateau, down onto the edge of it. 0.60 is
  taken over 0.65's marginally better F1 because it is mid-plateau and a full
  0.10 clear of that cliff: rule 5 is not a tie-break to be spent, and a
  threshold one step from dropping the day's biggest story is not worth 0.08.

  No category measurement accompanies it and that is correct rather than
  missing. A demotion reorders and removes nothing, so it can only act where the
  render cap binds, and a tab draws at most 46 against a cap of 70.

**Where the three changes leave the sieve, measured in one run**: day-wide mean
F1 **49.48 → 54.10** and mean precision **71.07 → 77.85**; the 24 category cells
**55.07 → 67.02**. All of it from the analyser being in-process — one new
signal and two thresholds it invalidated.
- **The specificity clause is disabled on purpose** (`min_spec` 9.9, above the
  signal's maximum of 1). Rescuing a word for being confined to one section
  admits exactly the words that mean nothing on their own — 감찰, 윤리, 청문, 초등
  and 순회 all score a perfect 1.00, for the same reason the fragment 알뜰 does.
  Turning it off gained 6.8 and 14.2 F1 points on the two measured days.
- **The neighbours clause is disabled too** (`max_neighbors_per_doc` −1, below
  the signal's minimum of 0), by migration `0009`. Two of sieve 4's three
  rescues are now retired and **the length clause is the sieve**: it admits 68
  of the 70 drawn words, and its precision, 84.3%, is the whole sieve's. Do not
  read that as a leak to be plugged. The four signals were measured against the
  labels inside the length group and **not one of them separates its good words
  from its bad** — character length runs the wrong way (bad 3.59, good 3.33),
  headline count is flat, and recurrence across the archive's days is flat too,
  because at three days it measures "story that is still running" rather than
  "word that recurs whatever the news".
- **A fifth signal was found, and its shape is the lesson.** `head_pos` — where
  in the headline the word starts, averaged over the day's headlines holding it,
  0 leading and 1 trailing. Korean headlines are topic-first: a story's names
  lead and generic qualifiers trail. Over the 280 drawn word-days of the four
  labelled days the mean is 0.347 for good and 0.466 for bad, and above 0.70 it
  catches almost exactly the family that means nothing on its own — 가능성,
  시험대, 승부수, 변동성, 무방비, 막바지, 월요일, 테러범, 수도권.

  **As a hard cut it was right day-wide and wrong on the tabs**, and both
  measurements are real: `head_pos <= 0.70` took mean F1 from 65.05 to 67.30 over
  four days, winning three and losing none, and then took the 24 category cells
  from 65.08 to 63.42, **losing 8 and winning none**. The render cap explains
  both. Day-wide it binds at 70, so cutting a word promotes a deeper one and the
  promoted words are about as good as the screen average — **the gain was the
  substitution, never the removal**. A tab draws at most 46 words, the cap never
  binds, and a cut there is loss with nothing to fill the hole.

  So it ships as a **demotion**, which can only act where a substitution exists.
  Round six measured that it reproduces the cut's day-wide numbers exactly
  (71.9 / 67.8 / 65.8 / 63.7 against 70.7 / 67.8 / 63.1 / 58.6) and leaves the
  category mean at 65.08 to the decimal. 0.70 is interior to its sweep — 0.65
  gives 66.68 and 0.75 gives 65.68 — and at 0.50 폭염 sinks to rank 66 on
  2026-07-31 and off the screen on 08-03.

  **Do not re-file this as a sieve clause.** A day-wide win with a category loss
  is the signature of a mechanism that needs the cap to be binding, and the fix
  is the mechanism rather than the threshold.
- **The dictionary is still doing real work**, and the fifth signal does not
  replace it. With the dictionary off, the demotion is worth about 2.5 mean F1
  on its own — so it is not merely re-catching what `word_overrides` already
  catches — but every dictionary-off configuration still drops the day's biggest
  story on three of four days, because 폭염 is two characters and lives on its
  `allow` entry.
- **`allow` entries are load-bearing, not decoration.** 폭염 and 양산 were given
  theirs in `0003` as insurance against exactly the retune `0009` performed, and
  they are now the only two words on the canvas not admitted by length.
- **Category specificity must be computed across all six sections**, never within
  the filtered view. Inside one category every word sits in one bucket, entropy
  collapses to zero, and every word scores a perfect 1.
- **Every sieve clause counts over the whole day, including sieve 1.** That last
  part was not true until migration `0004`: `min_headlines` counted headlines
  inside the category on screen while every other signal was day-wide, so a word
  in three of the day's headlines split across two sections appeared in neither
  section's graph. Category tabs drew 6 to 20 words. Moving the count day-wide
  took mean F1 from 40.4 to 61.2 across six categories and two days, winning in
  all twelve cells (`scripts/analysis/11_category_eval.sql`). The category filter
  now decides only which of the day's words are shown and how big they are, never
  which ones qualify. The all-categories view is unaffected by construction —
  with no filter the scoped set is the whole day.

Measured precision of the top 70 words, four days, as of 2026-08-04 — **the
first run on an archive analysed end to end by one analyser**:
**75.7 / 70.0 / 70.0 / 68.6**, mean F1 55.45. The drawn set is 199 good and 81
bad. On the 24 category cells the shipped configuration means **57.20**.

**Every one of those numbers is lower than the ones this file used to carry
(85.7 / 84.3 / 70.0 / 67.1, mean F1 63.2, 215 good and 65 bad), and the drop is
mostly not a quality drop.** The archive was re-analysed when ETRI was replaced
by garu-ko (`scripts/reanalyze/`), which put words on screen that had never been
near it, so `20_unlabeled.sql` returned 38 and `21_unlabeled_category.sql`
returned 232 — the sixth and largest firing of rule 4. Twenty-four of the 38 were
labelled bad, and a newly labelled bad word lowers precision the moment it is
labelled, whatever the analyser did.

**The per-day split is what shows this rather than argues it.** 2026-08-03 drew
no newly labelled word at all and its precision *rose*, 67.1 to 68.6, while
07-31 and 08-01 drew 8 and 7 of them and fell hardest. The days that moved are
the days whose screens changed.

What the run does establish, because it is internal to itself: **the shipped
configuration still wins.** It beats length-only on all four days day-wide
(57.3/51.6/65.8/47.1 against 55.1/48.4/61.7/45.1) and every `min_headlines`
floor, and on the tabs it leads at 57.20 against 48.52 for the pre-`0004` scoped
count — so migration `0004`'s finding survives the analyser change intact.

**Do not read the 2026-08-03 column against the one this file carried before
that** (71.4, mean F1 67.3). That move was the collector going to six runs and
the day going from 900 headlines to 2,197 — not the sieve, and not the analyser.

**F1 is not comparable across days of different thickness, and this is the
mechanism.** Recall is the drawn good words over every good word with `df >= 3`,
so a fat day has a much larger denominator while the screen still holds 70:
08-03's good pool is 129 against recall of 36.4%. A thick day therefore scores
*worse* on F1 while showing strictly more of the news. Judge configurations
against each other inside one run — the rule this file already states for label
sets applies to collection depth too, and this is the first time it has bitten.

Those figures come from
`analysis.word_labels` and are **not comparable to any percentage quoted
elsewhere, or to any earlier figure in this file's history** — the label set has
been extended eight times and each extension moves them, most recently by
`14_labels_after_reanalysis.sql` (38 words) and
`15_labels_category_after_reanalysis.sql` (234, the largest pass there has been).
Compare configurations against each other inside one run, never against a number
someone wrote down.

Two tells came out of that pass and both are reusable, because both name a kind
of word rather than a word:

- **A section tag is not a subject.** 북리뷰, 주末머니, Y녹취록, 뉴시스Pic,
  배틀라인, 이슈톺, 손바닥, 종합2 all reached the screen and all are the
  newspaper's own furniture — every headline carrying one *ends* in it, in
  brackets. The signature is `spec` 1.00 together with a shared bracketed
  suffix, and it is worth checking before labelling a confident-looking 1.00.
  Y녹취록 was written down as good first, on the reading that it named one
  recording in one case; it names a standing column at YTN.
- **The operational form of the good/bad line is a question**, and it settled
  the hard cases where the prose definition did not: *would this word appear in
  a randomly chosen other week's news?* 압수수색, 유상증자 and 본회의 would,
  every week, so they are bad however particular the story that produced them.
  문자통보, 미장착 and 보릿돌교 would not.

That claim has now been measured three times. Reversing 윤리위, 반도체 and
李대통령 to good and 여의도 and 형사사법체계 to bad moved 2026-08-02 from 61.6 to
63.1 and 08-03 from 52.6 to 56.1; reversing **보완수사권** to good on 2026-08-03
moved that day from 65.7 to 67.1 precision and 46.5 to 47.2 F1 — and **neither
moved anything in the ranking**: the same configuration won by the same margin
each time. 보완수사권 is the sharpest version of the question so far, because it
was labelled bad on the reasoning that a power is not an event, and 거부권 sits
two entries away labelled good on the reasoning that it is the instrument one
dated fight is about. Both are true of both words; the line was drawn between
them and could not be stated, so it moved. 수사권 and 보완수사 stay bad, and the
distinction that survives is not specificity — it is that those name the power
in general, in any week, while 보완수사권 names the one a dated bill removed.
Where the good-word line sits changes the
percentages and not the verdict, which this file has always claimed and had not
until now measured.

`08_labels_after_dedup.sql` is itself the second half of rule 4 firing:
`02_sieve_configs.sql` was untouched, but migrations `0007` and `0008` moved the
data underneath it and `20_unlabeled.sql` returned eight words that had never
been near the cut before. **Run it before the harness, every time, whatever
changed.**

### Reading the same view twice costs nothing

`src/lib/queryCache.ts` sits under five of the query functions and holds the
**promise**, not the result, keyed on the arguments (TTL 5 minutes, 24 entries,
rejections evicted immediately so "다시 시도" really retries). Two things follow
that are easy to underrate:

- **The point is object identity, not the network.** `App.tsx` compares
  identities everywhere — `graph`, `graphWords`, `partition.graph === graph`,
  `eventCounts.of === eventGraph`. Handing back the same object skips the label
  measurement, the Louvain partition, the 300-tick simulation, the edge routing
  **and** the follow-up round trips, and the event list appears without its
  one blank frame. Measured on a tab round trip A→B→A: 6 requests on return
  became 0; on a date step there→back, 9 became 0.
- **`fetchWordCountsFor` needs it too**, which an earlier reading of this got
  wrong: `graphWords` keeps its identity across a date step, but `selectedDate`
  changes, so the surge effect re-runs regardless. Before it was cached it was
  the only request still going out on a return trip.

Tests share the module-level cache, so `queries.test.ts` calls
`clearQueryCache()` in a `beforeEach`. Without it one test's response leaks into
the next.

**`main.tsx` fires the first `keyword_graph` request before React mounts**, off
the URL, and the cache is what makes that safe rather than wasteful: App's own
call gets the same promise and the same object back, so it is one request and
one layout, not two. It pairs with the `preconnect` in `index.html` — the
handshake is finished by the time this fires. Without the cache this line would
simply add a request. The category comes from `parseUrlState` with no slug list
yet, which is the same "not yet known" path App uses on first paint.

**The skeleton is only raised for a view that actually has to be waited for.**
`loadGraph` starts the request, then schedules the `setLoading(true)` on a
microtask and skips it if the promise has already settled — which is what a
cache hit looks like. Flashing the skeleton for one frame would undo the whole
saving; nothing would look faster. Note that `expect(skeleton).toBeHidden()`
**cannot** test this: the auto-retrying assertion never sees a frame that is
already gone, and it passed against the unfixed code. `appControls.spec.ts`
installs a `MutationObserver` and asserts the element was never inserted, which
does fail without the fix.

`src/lib/supabaseClient.ts` builds a **`PostgrestClient` directly** rather than
calling `createClient`. There is no login, no realtime, no storage and no
function invocation here, but `createClient` instantiates auth-js and
realtime-js eagerly, so no bundler can drop them: they were 443 kB of the built
JS. The two headers supabase-js used to add — `apikey` and the `Bearer` token,
both the same anon key — are set by hand, and nothing about the access model
moves. Bundle went to 251 kB (gzip 130 → 81). The Edge Function still uses
`npm:@supabase/supabase-js` and is unaffected.

### Design tokens

Every colour on screen is defined once, in the `@theme` block in
`src/index.css`. Components hold `var(--color-*)` strings, never hex — a second
copy of a hex value is how the six section colours drifted into an 80-degree
band, four of them indistinguishable in the all-categories view.

`src/lib/theme.test.ts` reads that block back and fails the build if the
palette breaks either rule it was chosen to satisfy: **no two sections within
40° of hue**, and **4.5:1 against the ground** (4.5 rather than the 3:1 for
large text, because `MIN_FONT_SIZE` is 14). The surge colour is held 40° clear
of all six as well, because the marker is drawn touching its word.

**Nothing is shaded on the canvas any more** — see "Event clusters" below for
why the blobs went. `--color-cluster` and `--color-top-story` survive the change:
the top story's blue is now the dot on the first row of the event list, and the
achromatic grey is kept, unused, with its test, because the finding is about the
palette rather than about the shape it was picked for. Two washes distinguished
by opacity alone failed — 0.07 and 0.07 stack to exactly the 0.14 that was meant
to single the top story out — and grey cannot stack into blue. The grey is a true
grey (`#737373`), **not slate**: slate-500's hue is 215° against the top story's
221°, six degrees from the thing it exists to be told apart from.

**The tab row is the canvas's colour key.** Section ink appears in exactly two
places, the words and the dot on the tab that filters for them, and
`src/lib/sectionColors.ts` is the one definition both read. A key that names a
different green from the one on screen is worse than no key, so
`e2e/keywordGraph.spec.ts` asserts the two resolve to the same rgb.

**The webfont is loaded from `index.html`, never from `index.css`.** It used to
be an `@import` at the top of the stylesheet, which looks correct and is not:
`@import "tailwindcss"` is inlined into ~940 lines of rules, so a font import
written below it lands after real statements and CSS drops it. The build said so
("@import must precede all other statements") and the browser agreed silently —
the masthead had been falling back to `ui-serif` and Noto Serif KR had never
once loaded. A `<link>` in the markup cannot hit that ordering trap at all, and
it starts the download while the HTML is still parsing rather than after the
stylesheet has been fetched and scanned. `preconnect` to both font hosts sits
beside it.

`--font-display` (Noto Serif KR) is used on the masthead date and the panel
heading and **nowhere else**. The graph measures its labels on a canvas against
`FONT_FAMILY` in `KeywordGraph.tsx`, so the canvas stays on the system stack: a
webfont there would be measured before it loaded and every label box would be the
wrong width.

SVG `fill` and `stroke` go through inline `style`, not presentation attributes —
`var()` is unreliable in the latter. `opacity` and `stroke-opacity` stay
attributes: `e2e/keywordGraph.spec.ts` asserts on them directly.

### Drawing the graph

`src/components/KeywordGraph.tsx` measures each label on a canvas and hands the
widths to `src/components/graphLayout.ts`, which owns all the arithmetic. That
split is what makes the layout testable: jsdom has no canvas, so anything calling
`measureText` cannot be unit-tested. Same pattern as `wordCloudLayout.ts`, whose
`computeFontSizes` the graph still reuses unchanged — the sieve decides who is
drawn, never how big.

**The layout is two stages, and there is no global simulation.** This was one
`forceSimulation` over all 70 words, and the trouble with it was structural
rather than a matter of tuning. A day is not a hairball: it is eight to a dozen
constellations of three to eight words plus 23–28 words holding no edge at all
(`scripts/layout/README.md` has the counts for four days). The global sim knew
none of that, and `isolatedRings` sent the edgeless words to rings at 0.36–0.52
of the *short side* — inside the canvas — so unrelated words sat between the
events and every edge had to cross somebody else's story.

- **Stage A lays each event out in its own box** (`layoutEvent`), and **stage B
  packs those boxes into the given width** (`shelfPack`). Separation now comes
  from placement rather than from a balance of forces, so it is guaranteed
  instead of tuned.
- **The unit of a region is a *merged event*, never a raw Louvain community.**
  `src/lib/events.ts` joins two communities linked by `MERGE_MIN_EDGES` into one
  event, and the canvas calls that same `mergeCommunities` — dividing by
  community would split a story the list calls one. Before this, the cohesion
  force pulled raw communities while the list counted merged ones, and the two
  had been quietly disagreeing.
- **Arrangement inside a region is chosen by topology, not taste.** A true star
  (`maxdeg === members − 1`) is placed radially around its hub, which has no
  crossings by construction. Everything else gets a small local simulation.
  Uniform radial was measured and rejected: **the day's biggest event is dense
  on all four days** — 13 words/27 edges on 08-02 where a tree would be 12 — so
  radial would leave ~15 chords crossing the wheel on the story that matters
  most.
- **`LOCAL_SLACK` must not approach 1.** The local box is sized from the members'
  label areas times 3.5. At 1.0 the collision pass cannot resolve — 12 to 19
  overlapping label pairs on every day, against an invariant of 0 — and two
  labels that end up touching leave no room for a stroke, so edges vanish
  silently: 22 of 37 drawn. That is CLAUDE.md's cohesion-at-0.35 failure
  returning by a different door. Slack is cheap because `crop` sizes the region,
  not the box.
- **Edgeless words go to a band *below* the packed regions**, not to a ring
  inside them. That is what actually empties the middle. They flow at
  `DEFAULT_PADDING`, not at the region gutter — they are unrelated to each
  other, but they are all unrelated in the same way, and gutter-sized gaps would
  assert a grouping that is not there.
- **Bridged events are packed next to each other** (`orderForPacking`). Ordering
  by area alone sent one bridge diagonally across the frame: edge length maxed
  at 719px against 208 before the rewrite. Ordering greedily by ties to what is
  already placed brought it back to 228–337.
- **Height is an output, not an input.** `LayoutOptions` has no `height`;
  `bounds.height` is the answer. `MIN_HEIGHT`/`MAX_HEIGHT`/`HEIGHT_RATIO` and
  the whole `NARROW_WIDTH`/`NARROW_HEIGHT_PER_WORD` branch are gone. That branch
  existed because inventing a height from the width gives a phone a box far too
  small — 358×279, which the collision pass cannot resolve, and 2026-07-31
  really did draw one overlapping pair there. Not inventing a height removes the
  problem rather than compensating for it.
- **`crowded` fell on all eight measured cells; `crossings` did not.** It fell on
  five, rose on three, and the rises are worth knowing: desktop 08-01 went 0 → 1
  because 34 edges are sparse enough that the old global sim happened to find a
  crossing-free arrangement, and 08-03 rose because **the remaining crossings are
  now almost entirely inside one dense event** (`xIn` 18, `xBr` 0). Crossings
  between unrelated stories are gone. Do not read the flat total as "no change";
  read the `xIn`/`xBr` split, which is why the harness prints it.
- **`xBr` is not one thing either, and splitting it overturned the diagnosis.**
  Once collection went to six runs a day, 2026-08-03 doubled and its bridges went
  2 → 7 with `xBr` 0 → 14, which reads as "the greedy ordering can no longer put
  every bridge next to its partner". `scripts/layout/bridges.ts` breaks that
  column into bridge×bridge, bridge×**own** region's inner edges, and
  bridge×another region's inner edges. Across eight cells the first is **1** and
  the third is **3** (all from one 703px bridge on a day with two bridges and no
  reordering freedom); everything else — 14 of 14 on desktop 08-03 — is a bridge
  cutting its **own** event's spokes on the way out. `orderForPacking` cannot
  touch that. A word sitting mid-box crosses its event whichever way it leaves.
- **The fix is a mirror, and it was chosen for a property rather than a score.**
  `faceBridges` flips each region within its own box (identity / horizontal /
  vertical / both, cheapest total bridge length, iterated to a fixed point).
  Reflection is an isometry, so the box keeps its size — no re-packing — and it
  **cannot change `xIn` or `overlap` at all**, since those depend only on
  distances inside the region. It is a lever that can only move the thing it was
  built for, which is why there is no regression surface to guard. Measured:
  `xBr` 24 → 13 over eight cells, desktop 08-03 14 → 5, `xIn` and `overlap`
  identical everywhere. It converges in **one** round; `FACE_ROUNDS` (4) is slack,
  not a tuned number — 1, 2, 3, 4 and 8 all give the same picture.
  One cell regresses and it is instructive: phone 08-03 goes 4 → 5 because the
  cost is **length, not crossings**, so shortening one bridge can drag another's
  exit across more spokes. Switching the objective to a crossing count would buy
  one crossing on one of eight cells and cost the geometry of every inner edge at
  flip time. Not done.
- **`xIn` was not one thing either, and the same split settled it.** A story's
  lines crossing each other may be forced by its graph or left there by the
  layout, and only the second kind can be fixed. `scripts/layout/planarity.ts`
  reports, per event, whether it is planar and — if not — its **skewness**, the
  fewest edges that have to go, which is also the floor on that event's
  crossings under *any* drawing. Six events drew a crossing, their floors summed
  to 2 and they produced 30. Only 2026-08-02's thirteen-word 전당대회 is
  non-planar at all, and five of the six were flat-drawable all along, which is
  why sweeping `LOCAL_SLACK` and running `untangle` had moved none of them: the
  tool was wrong, not the setting. Neither edge counting nor subgraph search
  answers this — K3,3 clears the 3n−6 bound comfortably, and the Petersen graph
  is non-planar while holding K5 and K3,3 only as subdivisions. Both are in
  `planar.test.ts` for that reason.
- **`layoutCluster` draws an event flat when it can**, via `src/components/planar.ts`:
  Tutte's barycentric solve over a fixed convex outer boundary, with the
  non-planar case handled by dropping the smallest edge set that makes the rest
  planar and laying those edges back on top. **It computes no planar embedding**
  — it tries short cycles as candidate boundaries and returns a drawing only
  after verifying on the original edges that nothing crosses and no two points
  coincide. Failing to find a drawing that exists costs nothing, since the force
  layout is still there; returning a wrong one would, and this way round cannot.
  Three things had to be measured rather than reasoned:
  - **Tutte coordinates are unusable as drawn.** They need 3-connectivity, and a
    day's events are sparse, so the graph is triangulated first — which makes
    every face a triangle, hangs ten points inside one, and wants **31x** the
    area (13 words) or **199x** (11 words). Scaling to separate labels is safe,
    since crossings are similarity-invariant, but 865px became **7,377px**.
  - **Seeding the force simulation from the flat drawing does nothing at all.**
    300 ticks walk back to the same minimum and all four days returned to their
    old numbers. A force layout does not remember where it started. Do not
    re-run this experiment.
  - **Bounding each step does work.** Cap a vertex's move at a third of its
    distance to the nearest edge it does not touch and no edge can cross another
    (PrEd's argument). And spreading and scaling **solve different days** —
    spreading unlocked 08-02, scaling unlocked 08-03 — so both are candidates
    and the winner is measured per event.
  The area a flat drawing may cost is priced **per crossing removed**, and that
  price must be a condition of entry: applied to the winner instead, the
  candidate that removes the most crossings wins and is then disqualified,
  taking the affordable one with it (08-02 went back from 5 to 15 that way).
  Measured: `xIn` 60 → 18, `crowded` 28 → 11, `overlap` 0 throughout, events
  drawing a crossing 6 → 3 against a floor of 2. **The price is height** —
  08-02 desktop 651 → 1544px — **and the per-crossing price is a cliff, not a
  dial**: 0.15, 0.25 and 0.35 draw the four days identically to having no planar
  path at all, and 0.5 buys the whole move. There is no middle setting, so this
  is a judgement about the picture rather than something the harness settles,
  and `PLANAR_AREA_PER_CROSSING` reverses it.
- **Shelves wrap like a snake, and the packing order was never the problem.**
  `orderForPacking` puts bridged events next to each other, and the shelf wrap
  then splits that pair across the full width of the canvas — the two boxes
  deliberately made adjacent end up as far apart as possible. That was the 703px
  bridge on desktop 08-01 that `OPEN.md` had written off as unfixable because
  the day holds only two bridges. Mirroring odd shelves takes it to 274px and
  its `xBr` to 0, with no constant involved. **First-fit packing is measured and
  declined**: reclaiming the row a two-word event wastes saves 5–11% of the
  phone's height but takes phone 08-03 from 6 bridge crossings to 9, because
  going back to fill an earlier shelf is the same act as separating the
  neighbours `orderForPacking` just placed. A wasted row is cosmetic; a bridge
  cutting through another story is not.
- **The pass condition is written in terms of `xIn`/`xBr`, never total
  `crossings`** (`scripts/layout/README.md`). The region rewrite dropped `crowded`
  on all eight cells while raising total `crossings` on three, so the total called
  a better picture a failure. `overlap` is the only column with an absolute rule:
  never above 0. And a change that claims to move `xBr` has to show the
  three-way split, because the total does not say whether the cause was guessed
  right — the paragraph above is what that costs when it is skipped.

Still true, and still arrived at by looking at real days:

- **Initial positions are seeded explicitly.** d3-force places any node without an
  x/y on a phyllotaxis spiral centred on the origin — the box's top-left — and
  relies on the centring forces to carry it in. At these force strengths 300 ticks
  does not cover half a box, so nodes settled up and to the left with the rest
  of the frame empty.
- **`forceManyBody`'s `distanceMax` must stay capped** at half the box. Letting
  repulsion act across the whole frame pushes the outermost words into the bounds
  clamp, where they pile up into a column stuck to the wall.
- **The viewport is cropped to the labels.** A category with eight words gets a
  small frame instead of a clump adrift in a large one.
- **Crowding is `DEFAULT_PADDING`, not box size.** What two adjacent labels rest
  at is the collision padding. Do not raise it past ~16: at 22 a 40-word canvas
  can no longer resolve its collisions and labels overlap, which
  `graphLayout.test.ts` catches.
- **Widening buys nothing.** The svg is drawn at its own cropped size and then
  `max-w-full` scales it down to the container, so spreading sideways shrinks
  everything by the same factor.
- **`h-auto` on the svg, not `max-w-full` alone.** The element carries `width`
  and `height` attributes, so capping the width leaves the height at the box the
  layout ran in and the drawing is letterboxed inside it. That put a 141px
  band of empty canvas above and below the graph on a phone.

- **A resize under 8px does not re-run the layout** (`nextLayoutWidth`), and the
  width feeding it goes through `useDeferredValue` so a re-layout does not block
  paint. One layout of 70 words and 60 edges measures **48ms**, and the cost is
  the simulation rather than the edge routing — with the edges removed entirely
  it is still 37.5ms, while 20 words with the same 60 edges is 5.5ms. Dragging a
  window edge from 1280 to 358 at 6px a frame ran 154 layouts and now runs 76.
  The 8px is invisible because the svg is drawn at its own size and then scaled
  by `max-w-full`.
- **`rectCollide` is not where that 48ms goes**, and it looks like it should be.
  Hoisting the outer node's fields out of the inner loop and dropping the `?? 0`
  guards (every node is seeded with x/y/vx/vy, so they never fired) produced a
  bit-identical picture — coordinate sums matched to four decimals — and a time
  inside the noise, 38.3ms against 38.7ms on the same fixture. The cost is
  d3's own forces across 300 ticks, so anything that actually moves this number
  changes the picture. Do not re-run this experiment.
- **Both figures above predate the region rewrite and have not been re-measured.**
  They should now be lower rather than higher — the simulation runs per event
  instead of over the whole day, so the biggest collision pass is 14 nodes and
  91 pairs a tick rather than 70 and 2,415 — but `untangle` adds a cost that did
  not exist before, and nobody has put a number on the pair. If the layout ever
  feels slow, measure before assuming which half it is.

Collision is rectangular rather than d3's circular `forceCollide`, because a
circle around a wide label is roughly three times taller than the text and leaves
words floating in the gaps. The box is 1.2x the font size tall, not 1x: `getBBox`
on drawn Hangul spans ascender to descender, and treating the em box as the
collision height left neighbouring rows grazing by a pixel.

**One relationship, one stroke.** Each edge is a single quadratic Bézier that
bows around whatever labels sit in its way. Strength is carried by width and
opacity, never by the number of strokes.

**The strong/weak contrast is normalised from 0.3, not from 0.** Observed NPMI
runs 0.31 to 1.00, so scaling from zero packed every real value into the top
two-thirds of the range and nothing could be told from anything: width lived
inside a 1.1px band and opacity inside 0.26–0.48. Individually invisible,
collectively noise. `EDGE_NPMI_FLOOR` cuts the unused bottom off, and width
(0.8–3.0) and opacity (0.15–0.85) then spend their whole range on the values
that actually occur.

**Every edge is the same neutral grey, in both views.** They used to be stroked
with a gradient between their two endpoints' section colours, which did make a
crossing readable without tracing it — and cost too much. A word cloud already
spends hue and size on every label, so a line that carries colour of its own is a
third layer of it, and the words at each end already say which sections a stroke
joins. Do not reintroduce the gradient.

This replaced a routing that subtracted every label box from the centre-to-centre
line and drew the remainder. That kept the strokes off the text, but it split one
edge into up to five collinear dashes — measured on 2026-08-01, where 15 of 63
drawn edges arrived in pieces — and several dashes read as several
relationships. **Do not reintroduce cutting.**

Three things there were settled by measurement, not by argument:

- **A crowded edge is drawn anyway, and faded.** At 110 words a long edge crosses
  something whichever way it bows; no single quadratic threads that field.
  Dropping those lost 18 of the day's 68 relationships. `EdgeCurve.clear` says
  whether the route stayed off every label, and `KeywordGraph.tsx` halves the
  opacity when it did not. A faint line under a word beats a missing connection.
- **Both sides get tried before settling.** The chord arithmetic names a cheaper
  side, but that side can be the crowded one; searching only it dropped 18 of 68.
  The search sweeps outward from straight, cheaper side first at each distance,
  and keeps the least intrusive route rather than the first clean one.
- **An edge is still dropped when the two labels nearly touch** — there is no
  room for a stroke between them. `DEFAULT_PADDING` has to leave more room than
  the endpoint trim consumes, or clustered words lose their edges: cluster
  cohesion at 0.35 did exactly that and removed half the lines on screen.
  Two of 68 edges are dropped this way on 2026-08-01, which is the intended
  behaviour rather than a fault.

### Event clusters

Communities come from **modularity** — Louvain's local-moving phase, in
`graphLayout.ts`. Connected components are the obvious choice and are wrong: on a
category tab they give clean events, but on the all-categories view 130 words and
85 edges — the graph as it was when this was measured, before `render_cap` came
down to 70 — chain through shared words (대통령 — 한동훈 — 민주당 — 레버리지 — 곽상언)
and one component swallowed nine words spanning four unrelated stories. No edge
threshold fixes it, because the problem is topological rather than one of edge
strength.

The plan reserved clustering coefficient and chi-squared for this. Neither is
used: both score a single word's belonging, while modularity scores the whole
partition and cuts the chain at the bridging words. Clusters rank by total
headline count rather than by chi-squared — chi-squared is dominated by the day's
biggest event, which is the wanted behaviour for ranking events rather than a
fault, but headline count measures it directly with nothing extra shipped from
the database.

Communities are found from the edge list **before** anything is positioned, since
they depend only on topology. That ordering is what lets each event be laid out
in a box of its own rather than discovering the grouping after the fact.

**A star event is arranged around its hub** — the member holding the most edges,
ties broken on headline count then on the word so the pick is reproducible. Not
around the centroid: both hold a cluster together, but a centroid is an empty
point no word occupies, so the members ring a gap and there is nothing at the
middle to read the event from.

**Clusters are never drawn, and now they are not shaded, outlined or named
either.** A region is read from the whitespace around it. What the partition
decides is which box a word is laid out in, which event the hub belongs to, and —
through `src/lib/events.ts` — which stories the event list names.

They used to be shaded, six of them, and both halves of that were wrong. Six
overlapping washes were the dirtiest thing on screen: a hull is angular, and
where two met the page read as a smudge rather than as two events. Cutting to one
made it worse rather than better, because it turned noise into a false claim —
**a blob is the convex hull of its members' label boxes, so anything that happens
to lie between them is inside it.** On 2026-08-01 the hull for
트럼프·이스라엘·하마스·압박 also enclosed 폭염, 정청래, 김민석 and 이재명, four
words from other events. A hull is only honest when its members are already
adjacent, which is exactly when it adds least.

`PlacedCluster`, `findClusters`, `convexHull`, `clusterLimit` and
`clusterCohesion` are all gone with the region rewrite — cohesion is what
placement does now, and the hull had no remaining reader. `GraphLayout.regions`
replaces `layout.clusters` and is **also not drawn**; it exists so
`graphLayout.test.ts` can assert that two regions never overlap, which is this
layout's central invariant. That is the one difference from `clusters`, which
nothing read at all.

The layout is deterministic — seeded positions, a fixed tick count, and ties
broken on the word server side — so the same day always renders the same picture
and the e2e suite can assert on it.

### The event list

`src/lib/events.ts` turns the day into a list of events, above the canvas. It is
pure and does not touch d3: the canvas hands its Louvain assignment up through
`onCommunities`, and **that same partition is what the list is built from** —
never a second copy computed here, for the reason `keyword_signals` is not
reimplemented either.

- **Louvain communities are merged before they are listed.** Two communities
  joined by `MERGE_MIN_EDGES` (**2**) or more edges are one event, transitively,
  through a union-find. Not 1: 2026-08-01's 민주당–한동훈 hang on a single edge
  and the 전당대회 and the 국민의힘 지도부 are different stories. Not 3:
  2026-08-02's 순회경선·명청대전 hang on two and are one story, so 3 splits that
  day's biggest event.
- **An event's headline count is never the sum of its members' counts.** One
  article holding two member words is counted twice; the measured inflation runs
  1.10× to 2.22× and **grows with the member count, so the ranking is wrong and
  not just the number** — the real top of 2026-08-01 is 폭염 (sum 69, actual 61),
  not 트럼프 (73 / 51). Two RPCs exist for this, `event_headline_counts` and
  `event_headlines` (migration `0010`), because `count(distinct …)` is not
  something PostgREST can express and counting the rows of a response is the
  thing this file forbids. `countSum` survives only as the fallback order when
  the count RPC fails, and `topEvents` will not mix the two inside one
  comparison — the counts are used all-or-nothing (`fullyAligned`).
- **The counts and the partition are pinned to the graph they came from.** The
  partition arrives from a post-paint effect, so for one frame it belongs to the
  previous day; the counts are a separate round trip. `App.tsx` stores each with
  the object it was computed for and compares identity before use, so a
  transition blanks the list for one frame rather than showing yesterday's
  events, or yesterday's numbers, or ranking on them. Length is not a check: the
  archive's three days hold 15, 14 and 15 events.
- **The list answers the canvas back.** Clicking a word on the canvas lights the
  row of the event it belongs to and recedes the others at the canvas's own
  `UNFOCUSED_OPACITY` (`src/lib/focus.ts` holds that number once, for both).
  A bridging word lights every row it touches, matching what `focusWords` does
  on the canvas. **Canvas and list deliberately light different sets**: the
  canvas lights a word and its neighbours, which can cross an event boundary,
  while the list states membership. Two different questions, not a mismatch to
  fix. An event ranked below the list's five is **pinned onto the end** rather
  than inserted, so a clicked word always has a name without anything
  pretending to a rank it does not hold. With no event to light — 20 of the 70
  words hold no edge — **nothing is dimmed at all**; a wholly grey list reads as
  a fault.
- **The list holds `EVENT_LIST_LIMIT` (5) rows and can be opened to the day's
  full set.** Expanding passes `limit: Infinity` to `topEvents` rather than
  branching anywhere else, which makes `pinned` a no-op by construction — every
  event is already present. The toggle is the list's own last row, because it is
  about the list's length rather than a control that happens to sit beneath it,
  and it is not rendered at all when the day holds no more than is shown (a
  category tab, mostly). **It collapses on a date or a category change**: a day
  holds 14 to 17 events and a tab far fewer, so an expansion carried across a
  change leaves the page at the previous view's height showing a different
  view's content. `eventGraph` is the identity that moves on both.
- **The expansion is not in the query string.** It is not a shareable claim
  about the data, and the URL already carries a mutual-exclusion rule between
  `?word=` and `?event=` that a third axis would only complicate.
- **A word selection and an event selection are mutually exclusive**, in the
  click handlers and in the query string alike (`?word=` or `?event=`, never
  both). Two lit sets at once cannot be read off the canvas.
- **An event lights its members and not their neighbours.** A word selection
  expands to neighbours; an event already *is* a neighbourhood, and expanding it
  would light the event across a bridge that the merge rule had just declined to
  join. A bridging word is the exception by construction: it lights every event
  it touches, whole, which is what makes the bridge visible as a bridge.

### Day-over-day surge

`src/lib/surge.ts` marks the words that gained the most of the day against the
previous **collected** date — not against yesterday, since the archive has gaps
and today is empty until the 13:00 KST cron runs. Two things there were settled
by measurement and should not be re-argued from first principles:

- **Shares, never raw counts.** 2026-08-01 was collected twice and holds 1,144
  headlines against 2026-07-31's 899, so on counts every word is up about 27%.
  Dividing each day by its own headline total makes a uniform inflation cancel;
  the median drawn word then sits at a ratio of 0.98, which is the check that
  the normalisation works.
- **A rank, not a threshold.** A ratio cut of 1.5 marked 58 of the 110 words
  drawn on 2026-08-01 — half the screen, which points at nothing, the same
  failure as shading all 26 communities. Ranking on *gained share*
  (`today_share − previous_share`) rather than on the ratio keeps a big word
  that grew ahead of a small word that appeared: 까마귀 (10 headlines, new)
  beats 호르무즈 (18 headlines, 5.9x) on ratio and loses to it on gained share.
  The top eight on that day were 유조선 · 호르무즈 · 한동훈 · 곽상언 · 공습 ·
  까마귀 · 아르헨 · 이스라엘.

`surgeLimitFor` scales the cap with what is on screen (~1/14, floor 1, ceiling
8), because a flat eight is an annotation on 110 words and covers most of a
category tab that drew twenty.

Kleinberg's burst model is the proper instrument and is what the plan reserves
for this, but it measures against a historical baseline and the archive is two
days long. Revisit it when there is history to measure against.

### URL state

Date, category and selected word live in the query string (`src/lib/urlState.ts`),
synced with `history.pushState` and `popstate` — no router, since there is one
route. Two details that are easy to get wrong:

- The **first** write is a `replaceState`, because it only fills in the date the
  app defaulted to; pushing it puts a duplicate of the current view on the stack
  and the first press of Back appears to do nothing.
- `parseUrlState` takes the known category slugs and drops anything else, but an
  **empty** slug list means "not yet known" rather than "nothing is valid" — the
  categories arrive from a second query, so on first paint a shared link's
  category would otherwise be discarded before it could be validated. `App.tsx`
  re-checks once they load.

### Edge Function run budget

The function paginates each section's "더보기" endpoint to 150 headlines, six
sections per run.

**The limit that kills this function is CPU time, not the wall clock, and every
number in this section used to be written against the wrong one.** The platform
allows roughly **3 seconds of accumulated CPU per worker** and says so in the
logs — `CPU Time exceeded` — before returning 546 WORKER_RESOURCE_LIMIT with no
body at all. A 45s run has died where a 64.6s run passed.

Analysis is not what spends it. Measured on the platform: **0.88ms a headline,
900 of them for 0.8s, heap flat at 9MB.** What spent it was the round trips
around them — a lookup, a count, and two inserts per headline, about 2,700 of
them. Under ETRI every one of those sat behind a ~500ms wait, so the worker
idled through ~98% of a 64s run and its cumulative CPU stayed small. **Removing
the wait did not add CPU; it removed the idling**, and the function died the
first time it was deployed with the analyser inside it.

So storage is **batched per category** (`processHeadlines`): one lookup per 50
links, carrying an embedded `headline_nouns(count)` so "does this exist" and
"does it already have nouns" are answered in the same request; one upsert with
`onConflict` so an overlapping cron cannot fail the batch; a few noun inserts.
Five or six requests where there were ~450. A full 900-headline run now takes
**4-5 seconds** — 5.0s measured on the heavy path where 755 headlines all needed
analysing — against 44.9s before, when it returned a summary at all.

`ANALYSIS_CONCURRENCY` is **deleted**, not merely unreasoned: eight in flight
existed to hide ETRI's wait, and with sequential batches there is no wait to
hide. `RUN_BUDGET_MS` (50_000, divided into a per-category slice so the last
sections are not the ones starved) survives, but it is wall clock and therefore
**cannot see the limit that does the killing** — what keeps the run inside the
CPU budget is the batching. It now has ten times the slack it needs and may be
able to go away.

A killed run returns no body, so the `summary` this file calls `index.ts`'s only
check is exactly what is missing when it is most needed. The function logs
`CHK <category> scraped/processed` lines for that case.

**It runs six times a day, four hours apart** (03, 07, 11, 15, 19, 23 KST — six
pg_cron jobs, all calling the same function). Note that **`cron.job_run_details`
is not a health signal**: `succeeded` means `net.http_post` queued a request and
returned a row, and all six jobs read `succeeded` throughout the days when ETRI
was blocked and nothing was collected. Check `max(created_at)` on `headlines`.

Running more often is the better instrument on its own terms: **a deeper page is
older news, a later run is newer news.** Measured on 2026-08-03, one run some
hours after the 07:00 cron found 404 new headlines inside the same
150-per-section window — the sections churn all day. The day went from 900
headlines to 2,197. There is no external call limit any more.

**Raising `MAX_HEADLINES_PER_CATEGORY` deserves re-testing rather than the
refusal that used to stand here.** The 300-over-12-pages failure was read as a
wall near 63s; it was CPU, spent on ETRI-paced round trips that no longer exist.
Deeper paging may now fit, and nobody has tried.

That change is what settled the `min_headlines` question — see the round-seven
section of `scripts/analysis/README.md`. The short version: on a thin day the
word at rank 70 has three headlines, so a floor is the screen; on a fat day it
already has eight, so a floor of 4, 5 or 6 never reaches it. **A promotion floor
is unnecessary rather than deferred**, and `min_headlines` stays at 3 as a safety
net for a day whose collection failed.

Nouns are fetched *before* the headline row is inserted, so a failure leaves
nothing behind and the next run retries naturally. The duplicate path also
backfills headlines that somehow have no nouns.

## External services

- **Naver RSS is discontinued. Never use it.** Headlines come from parsing
  `news.naver.com/section/{id}` HTML plus its `SECTION_ARTICLE_LIST` pagination
  endpoint, which returns the same markup wrapped in JSON.
- **There is no morphological-analysis service any more.** `npm:garu-ko@0.9.12`
  (MIT, a 1.4MB model and a WASM binary) runs inside the Edge Function. No
  account, no key, no call limit, and `.env.functions` sets nothing.

  **It was measured against ETRI before it was adopted**, on 2,197 real
  headlines: **0.79ms a headline against ETRI's ~500ms**, 96% of noun rows
  identical, and 68 of the drawn 70 the same — 삼전닉스 and 오늘 the only movers.
  The analyser boundary the swap was expected to introduce is mostly not there,
  which is what made re-analysing the whole archive worth doing rather than
  merely possible: the table now comes from one analyser, which it never had.

  **Loading is the part that needs care, and only one path works.** The node
  entry (`import { Garu } from 'npm:garu-ko@0.9.12'`, then `Garu.load()`) reads
  the wasm and the model off disk through `fs/promises`, and npm packages sit on
  disk under Deno, so it simply works — measured at 91ms. Supplying the bytes by
  hand is **not** a fallback: the package's `exports` map defines no subpath
  beyond `.`, `./browser` and `./node`, so `garu-ko/models/base.gmdl` cannot be
  resolved and `./pkg/garu_wasm.js` is refused outright.

  ETRI's own history, kept because it is why this file used to say otherwise:
  the old portal `aiopen.etri.re.kr` shut down on 2025-06-30 and its successor
  `http://epretx.etri.re.kr:8000/api/WiseNLU` served 5,000 calls/day. The key
  went dead on 2026-08-03 and is **blocked rather than throttled** — probed again
  after the quota day rolled over and it still answers
  `{"success":false,"reason":"Blocked KEY"}`.

- **One article, one link.** The section's first page and its `SECTION_ARTICLE_LIST`
  pagination hand back different URLs for the same article —
  `/mnews/article/{press}/{id}` against `/article/{press}/{id}` — and the boundary
  falls at whatever the first page held (46 of 150 in politics on 2026-08-02).
  `canonicalLink` in `lib/headlines.ts` rebuilds both as
  `https://n.news.naver.com/article/{press}/{id}` before `extractHeadlines`
  dedupes, which is what makes the existing `UNIQUE (category_id, link)` the real
  invariant. It returns anything it cannot parse **unchanged**: mangling an
  unrecognised href would merge two different articles into one link and lose one
  of them silently. That fail-open design means a change in Naver's URL shape
  would produce duplicates again with no other signal, so the only thing
  standing between this bug and its silent return is this query, which must
  return 0:

  ```sql
  select count(*) from (
    select category_id, substring(link from '/article/(\d+/\d+)') as k
    from headlines group by 1, 2 having count(*) > 1
  ) d;
  ```

- **One word, two keys — the same bug in the alphabet.** Naver's headlines use
  the Unicode CJK *compatibility* ideographs interchangeably with the ordinary
  ones. They render identically and are different strings, so before migration
  `0012` `headline_nouns` held `李대통령` twice with 15 rows split between them,
  and `李정부` twice over 3. Five occur in this archive: 李 U+F9E1→U+674E,
  金 U+F90A→U+91D1, 勞 U+F92F→U+52DE, 盧 U+F933→U+76E7, 女 U+F981→U+5973.

  **Fixed in two places, and it has to be both.** `extractHeadlines` normalises
  the title and `filterNouns` normalises the word. Normalising only the word
  would be worse than leaving it: `keyword_signals`' `standalone` matches the
  word against the title with a regex, so an NFC word against a raw title scores
  0.00 and the word is cut as a fragment. The title is also what is handed to
  the analyser, so the tokens come back already folded; `filterNouns` does it
  again rather than depend on the analyser echoing its input's code points.

  **NFC, never NFKC.** NFKC would also rewrite ￦, ①, ㈜ and the halfwidth forms
  these headlines genuinely use — different characters, not two spellings of one.

  Migration `0012` backfilled 54 titles and 15 noun rows. It changed no drawn
  word on any of the four labelled days: the whole sieve harness re-ran
  byte-identical afterwards. This query must return 0:

  ```sql
  select count(*) from (
    select normalize(word, nfc)
    from (select distinct word from headline_nouns) t
    group by 1 having count(*) > 1
  ) d;
  ```

Section IDs are fixed: 정치 100, 경제 101, 사회 102, 생활/문화 103, 세계 104,
IT/과학 105.

## Access model

No login. All tables have RLS enabled with select-only policies, and the views use
`security_invoker = on` so those policies still apply. Supabase's default grants
give `anon` write privileges on public-schema tables, but RLS blocks the writes —
inserts fail with 42501, and deletes/updates return 204 having matched zero rows.
Do not add write policies. The service-role key exists only in the Edge Function
environment.

## Testing notes

`KeywordGraph.tsx` and `App.tsx` have no unit tests: the graph measures text on a
canvas, which jsdom does not implement. Their layout arithmetic is extracted into
`src/components/graphLayout.ts` and `src/components/wordCloudLayout.ts`, which are
tested. The rendered graph and the `App.tsx` wiring around it are covered by the
Playwright suite in `e2e/` instead — `npm run test:e2e`, which boots its own dev
server.

`keywordGraph.spec.ts` (the graph), `appControls.spec.ts` (URL state, the date
stepper, skeletons) and `headlinePanel.spec.ts` all stub Supabase at the network
layer (`e2e/support/mockSupabase.ts`), so they do not depend on what was
collected that day. Three things that handler has to get right, each of which has
already caused a false pass or a failure:

- `keyword_graph` is an **RPC**: it arrives as a POST with its arguments in the
  body, so a handler keying off `p_category` must read
  `route.request().postDataJSON()`, not the query string.
- `fetchHeadlineCount` is a **HEAD** request and reads its answer from the
  `content-range` header, not from a body. It is now only the fallback path, so
  `COLLECTED_DATES` carries the same totals as `HEADLINE_COUNTS` — derived from
  it rather than written out twice, since a drifted copy would make the surge
  assertions describe a day that does not exist.
- A default that varies by request has to be a function, and `resolve()` has to
  call it. Returning the function itself serialises to `undefined`, which reaches
  the app as an empty result and reads exactly like "no data" — the surge markers
  silently never appeared.

`e2e/smoke.spec.ts` is the only file that hits the real project, and it asserts
the seeded category tabs rather than collected words — nothing exists for the
current date between midnight and 13:00 KST, when the cron runs.

`e2e/smoke.spec.ts` needs a real `.env` (recoverable with
`npx vercel env pull .env --environment=development`); on a fresh clone without
one, `npm run test:e2e` fails 1 of 27 with a bare count mismatch. Also note
`playwright.config.ts` sets `reuseExistingServer: true`, so a dev server started
before `.env` existed will be silently reused with stale environment variables —
stop it first.

Asserting how many words were drawn is now safe in a way it was not under
d3-cloud, which silently dropped whatever did not fit: a force layout draws every
node it is given. Prefer naming specific words anyway — a count assertion says
nothing about which words the sieve let through, and that is the thing worth
protecting.

### Word quality is measured, not eyeballed

`scripts/analysis/` holds the sieve harness, run through `run.sh` because there is
no local Postgres. It scores threshold configurations against a hand-labelled word
set and prints precision, recall, F1 and the rank of the day's biggest story.

Two habits it enforces, both learned the hard way:

- **Every word on screen must be labelled.** Ranking inside a labelled subset makes
  a tighter sieve look better for free — labelled words get filtered out and
  unlabelled ones move up to fill the gap, invisible to the metric. The harness
  prints an `unlabeled` column; if it is not 0 the row is meaningless. Widening the
  configuration list promotes deeper-ranked words onto the screen, so **re-run
  `20_unlabeled.sql` after any edit to `02_sieve_configs.sql`** and label what it
  finds. That fired three times in one sitting.
- **Never optimise precision alone.** It does not punish discarding good words, so
  maximising it converges on dropping the day's biggest story — measured, not
  hypothetical. Judge on F1 and the `story_rank` column together. That story is
  per day and comes from `analysis.eval_days`, not from a hardcoded 폭염: it
  leads three of the four days and 김민석 leads 2026-08-02.

**The days and the configurations under measurement are each named in one
place.** `analysis.eval_days` (`12_eval_days.sql`) holds the days, and the
`active` flag in `analysis.sieve_configs` scopes the round without deleting its
history — `10_sieve_eval.sql`, `11_category_eval.sql`, `20_unlabeled.sql` and
`21_unlabeled_category.sql` all read both. A second copy is how rule 4 returns
silently: a day the harness scores but the worklist does not cover is a day
whose promoted words are never put in front of anyone to label.

`30_word_scores.sql` and `31_fragments.sql` are the other half: they explain one
day's screen word by word rather than comparing configurations. **They are
diagnostics and never grounds for moving a threshold** — that is still
`10_sieve_eval.sql`'s job, and adjusting a number because one day's dump looks
wrong is the habit the rules above exist to stop. `30`'s `chk` column cross-checks
its own copy of the sieve against `keyword_graph`'s node list and prints `!` on
disagreement, for the same reason the harness prints `unlabeled`; a `!` means the
script is wrong, not the sieve.

Two things they found on the first run, both recorded in
`scripts/analysis/README.md`. The compound merge did not restore 반도체, 무인기,
상한가 or 유조선, because it named the tags allowed to join a run and ETRI tagged
those words' prefixes `XPN` and suffixes `XSN`. **Fixed by inverting the rule:**
the headline's own spacing already says what belongs together, so an eojeol is
kept whole and the run breaks only on what is not part of the word.

**The rule outlived the analyser that motivated it, which is the argument for
it.** garu returns 반도체 and 무인기 whole, so an allowlist would not fail here in
the same way — and that is exactly why the denylist stays: it does not depend on
which splits any particular analyser happens to make.

The `standalone` cut's blind spot was the other, and it is now **measured and
closed with no code change** (2026-08-03, round four, four days). The signal is
genuinely wrong about a word followed by a 조사 — Korean attaches it with no
space, so 골리앗의 and 자국민에 score 0.00 exactly as 도체 inside 반도체 does. It
does not matter. Six words are kept off screen by this clause and nothing else
across the whole archive, **and all six are labelled bad**: 춘천시, 한화에어,
특별감찰 are real fragments, and 골리앗, 자국민, 폭등장 are the whole words the
signal misjudges. 골리앗 is the instructive one — four of its five headlines are
the same book, 『골리앗의 저주』, in a book-review column, and 북리뷰 and 저주 were
already bad. An earlier version of this file cited 유시민, 골리앗 and 앤트로픽 as
the cost; 유시민 now scores 0.67 and 0.92 and clears the cut, and the other two
sit below `min_headlines`. Turning the clause off loses 1.1 mean F1 day-wide and
0.4 on the category tabs, winning no day and no cell; `.05` through `.30` are
identical, so 0.10 sits mid-plateau. **Do not build a particle-aware variant** —
it would rescue three bad words and carry no measurement.

The archive **spans the merge's own deploy** — 1,716 of the 2,043 rows on the
two labelled days (2026-07-31 and 2026-08-01) were analysed before it first
shipped, measured post-migration; across the whole table it is 1,716 of 2,734 —
so a word count that crosses 2026-08-01 13:00 KST blends two analysers, and the
fix above adds a third boundary at its own deploy. The archived days are not
re-analysed.

Migration `0007`'s cleanup was not neutral between the two analysers, either:
keeping the earliest sighting means the 13:00 cron's re-collection lost rows
proportionally faster than the 08:00 manual run did (509 → 327 against
873 → 817), so 2026-08-01 is now *more* pre-merge than it was before the
cleanup — the sieve harness's labelled corpus did not merely shift when 0007
ran, it shifted toward the older analyser.

Migration `0007` collapsed the archive onto one row per article, which **moves
both labelled days**. Before re-running `10_sieve_eval.sql` for any reason,
re-run `20_unlabeled.sql` first: ranks near the cut are filled by different
words now. Measured cost on the drawn set: nodes held at 70 on both days and
the biggest story does not move (김민석 46→46 on 2026-08-02), but a pre-flight
check that asked "do these 70 words' existing edges still clear
`edge_min_cooc`" said edges were untouched, and that check was wrong — measured
edges moved 47→36 on 2026-08-01 and 57→58 on 2026-08-02. **A check that holds
the drawn node set fixed is not a check on the drawn graph**: edges are only
drawn between drawn nodes, the ranking shift changes which 70 words those are,
and the new set draws over a different pair set than the old one did. Some of
the lost pairs were never real co-occurrence to begin with — a pair that
appeared together in one story collected twice had been counted twice. The
percentages recorded above were taken before any of this, on the pre-migration
graph.
