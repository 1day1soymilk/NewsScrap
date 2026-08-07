# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal Naver-news keyword graph. A Supabase Edge Function scrapes six Naver
news sections daily, extracts Korean nouns with a morphological analyser running
inside the function itself, and stores them in Postgres. A Vite + React frontend reads that data and renders a
d3-force graph filterable by date and category: words that share headlines are
joined by an edge, size stays proportional to headline count, and clicking a word
dims everything outside its neighbourhood and lists the headlines it came from.

**`OPEN.md` at the repo root is the work queue** — what is open, what was
measured and declined, and where in the code each open item lands. Read it
before starting anything; a fresh session should not have to re-derive that
from the git log. `scripts/layout/OPEN.md` is the older, layout-scoped one and
still stands.

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

### The schema lives in four places

`supabase/migrations/*.sql`, the Edge Function's inserts, `src/lib/queries.ts`,
and — since migration `0030` — `word_directory`, all encode the same column
names. Changing one means changing all four. `word_directory` is derived from
`headline_nouns` and `headlines` rather than typed independently, so its place
on this list is a reminder to re-derive it, and refresh it, whenever either of
those two changes shape — see "The word directory" below.

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

**The section share is the one response that is summed, and it is not an
exception to that rule.** `fetchCategoryShare` reads `daily_category_counts`
(migration `0027`) filtered to one date and `CategoryShare.tsx` divides each
section by the sum of the six rows. What the rule bans is inferring a day total
from a response that may have been truncated; this response is six rows by
construction and the quantity divided by is literally "the sum of these
sections". The `.eq('date', …)` is what keeps it that way — six rows a day
reaches the 1,000-row cap in 166 days — so it is the rule being obeyed rather
than waived.

**`capped` is per run, never per day**, and that had to be learnt from a number
that made no sense. 2026-08-04's 02:00 KST hour holds **174** society rows
against a cap of 150, which reads as a cap being exceeded and is not: it is
124 + 33 + 9 + 8, five hand invocations inside fourteen minutes plus the 03:00
cron, and **no run stored more than 150 in any category**. A day is the sum of
six or more runs, so a day-wide count answers a different question than the one
the flag asks. There is no run id in the schema; `date_trunc('minute',
created_at)` is the available proxy, since a run writes its six sections in 4–5
seconds and the crons are four hours apart. Its one blind spot is a run
straddling :59/:00, which splits a capped run into two uncapped halves.

**And `capped` counts rows *stored*, not the window *scraped*, which is the
larger blind spot and the reason the caption is worded the way it is.**
`index.ts` upserts with `ignoreDuplicates`, so a run that filled its whole
150-headline window and re-saw one article it already held stores 149 and is not
flagged. Live instance, read after that day had closed: 2026-08-04 economy's
biggest run is **exactly 149** and its 948 headlines are drawn with no asterisk
although that run almost certainly bound. Both failures point the same way, which is the right way for a caveat to
fail — **a flag means the share is a lower bound, and the absence of a flag means
nothing.** The comparison is `>=` rather than `=` because a run made under a
deeper cap is still evidence the window bound (2026-08-03 07:32 UTC stored 275,
242 and 208 inside one minute), so the flag says "may have reached the limit" and
the UI says it that way. Making it a fact would take the collector storing what
it fetched alongside what it kept.

`daily_word_counts` is a `UNION ALL` of a per-category aggregate and an
all-categories rollup keyed by a null `category_slug`. **Do not rewrite it with
`GROUP BY GROUPING SETS`** — that form blocks predicate pushdown, so the planner
aggregates the entire history before applying the date filter. Migration
`0002_word_counts_pushdown.sql` explains the measurements.

### Word scoring and the keyword graph

`keyword_graph(p_date, p_category)` is an RPC rather than a view because the node
and edge cuts and the NPMI arithmetic have to happen server side — a day's word
pairs run to thousands of rows even after grouping, and PostgREST would truncate
at 1000. It returns `{nodes, edges}` as JSON. Functions here are all
`SECURITY INVOKER`, so the select-only policies still apply; `anon` needs
`execute` on the whole chain.

**Since migration `0032`, `keyword_graph` is a thin reader over
`keyword_graph_cache` and the computation lives in `keyword_graph_compute`.**
Everything the rest of this section says about the loop, the fixed point and the
helpers describes `keyword_graph_compute`; the name `keyword_graph` now means
"the cached answer, or compute it if there is no row". See "Why the graph is
cached" below for the measurements that forced it and for how a retune reaches
the cache since migration `0034`.

**`keyword_graph_compute` is `language plpgsql` and everything else here is
`language sql`, because the node rule is a fixed point** (migration `0024`).
With the place gate on, dropping a place promotes the word at rank 71, and that
word can be the only non-place partner some *other* place was hanging on by — or
can itself be the partner that rescues one. A recursive CTE cannot express it:
Postgres forbids window functions in the recursive term and the ranking is
`row_number()`. Hence a loop. **Termination is by monotonicity** — `banned` only
grows and can only hold places — and the iteration guard is derived from the
place count rather than hardcoded: `count(*) + 2` over the `place` rows of
`word_overrides`, which at the live count of 45 places is **47**. A hardcoded 50
would go stale the moment a place is added. When the guard fires it `raise`s,
since a silently wrong graph is worse than an error.

**The one copy of each decision survives the loop, split by what it depends
on.** `keyword_graph_candidates(p_date, p_category)` is expensive and
banned-blind — it runs `keyword_signals` once and applies sieves 1–4, and is the
only place that decides **whether a word may be drawn at all**.
`keyword_graph_rank(p_cands, p_banned)` is cheap and banned-aware — ranking, the
head_pos demotion, the cap and the `faded` / `is_place` flags, the only place
that decides **which of them are drawn and in what order**.
`keyword_graph_pick_edges(p_date, p_category, p_words)` is the only place that
decides **what an edge is**. `keyword_graph_nodes` / `keyword_graph_edges`
survive as thin wrappers for `scripts/analysis/`. The first version had one node
helper and one edge helper taking `(date, category, banned)` and the loop calling
them: correct, and **13 seconds with the gate on**, because `keyword_signals` was
being paid for eight times. Nothing was made faster; something expensive was
stopped from being asked eight times — the same finding the Edge Function records
from the other side, one layer up.

**Edge ordering gained `, a, b` and that was a latent bug rather than a
refactor's cost.** `order by npmi desc, cooc desc` is not a total order — three
pairs on 2026-07-31 carry `cooc` 3 and `npmi` 0.80097396756174372838, equal to
the last digit — so which came first was decided by the query plan, while this
file already claimed the picture is reproducible because ties are broken server
side. That was true of the nodes and quietly untrue of the edges.

`keyword_signals(p_date, p_alpha)` computes the per-word signals and is called by
both the RPC and `scripts/analysis/`. **Do not reimplement those formulas** —
tuning that measures a hand-copied second copy is measuring the wrong thing. It
gained `df_balanced` and its α parameter with migration `0025`; α defaults to
`scoring_weights.category_balance_alpha`, so the five existing callers were
unchanged.

`render_cap` is **70, and it is a display cap rather than a sieve threshold** —
it does not decide which words qualify, only how many of the ranked survivors are
drawn, so changing it does not go through `10_sieve_eval.sql`. It was 130, and
ranks 71 to 130 arrived faded at the minimum font size and sat in every gap
between the words worth reading. At 70 the drawn set is exactly the set the
harness measures. With it equal to `node_limit`, `faded` can now only mean a
`word_overrides` 'demote' entry. **Round fourteen put it through that harness
anyway and found out why the sentence was there** — see below.

Word selection is a **sieve** (thresholds in series), not a weighted score.
Blending the signals measurably makes it worse: each one catches a different kind
of bad word, and averaging dilutes each where it is strong.

Ranking is by frequency, and **`demote_head_pos` is the single exception**, added
by migration `0015`. A word that trails its headlines sorts below every word that
leads one, so it falls out only where the render cap is binding. Size is
untouched and stays proportional to headline count; what moves is which words
fill the last places under the cap.

Thresholds live in `scoring_weights` and the dictionary in `word_overrides`
(`exclude` / `demote` / `allow` / `place`, the last added by migration `0023`),
so retuning needs no redeploy. **Never change a threshold without running
`scripts/analysis/10_sieve_eval.sql` first** (or `11_category_eval.sql` when the
question is about a category tab) — its README records five ways this has already
gone wrong. Note that the labels go stale when the *data* moves and not only when
the sweep widens: collecting a date twice put 13 unlabelled words on screen and
silently invalidated a run.

#### The five changes the in-process analyser forced, and what generalises

Migrations `0018`–`0022` are one sequence: one new signal, two thresholds it
invalidated, a dictionary re-derived against the screen it produced, and then the
length bar it changed the job of. **Day-wide mean F1 49.48 → 63.70 and precision
71.07 → 93.53; the 24 category cells 55.07 → 78.58.** The sweeps are rounds nine
to thirteen of `scripts/analysis/README.md`. What has to survive here is what
would be re-derived without it:

- **A word is rescued for being a proper noun** (`min_proper` 0.50, `0018`),
  the largest single measured gain the sieve has had. `proper` is the share of a
  word's rows the analyser tagged NNP. **What it buys is the price of
  `min_word_len`, which had only ever been priced in one direction** — the length
  clause had been measured on what it *admits*, never on what it rejects, and it
  was rejecting 이란, 미국, 중국, 일본, 북한, 한국, 서울, 부산, 대구, 인천, 삼성,
  애플, 구글 and 기아 along with the noise. **Length was always a proxy and the
  analyser answers the real question**: garu tags 이란 NNP and 감찰 NNG, and
  감찰·윤리·청문·초등·순회 are exactly the five words that forced the specificity
  clause off, every one scoring a perfect 1.00 on spec. **`min_word_len 2` is the
  control and it is why this is the tagger's win, not length's**: admitting every
  two-character word scores 31.98 against the shipped 49.48. The cost was accepted
  on the numbers — 닉스 (from 삼전닉스) and 어스 (from 구글 어스) come in as
  fragments, and 유럽·남미·중동·호남 as regions.
- **It has the opposite signature to `head_pos`, and that is the general lesson.**
  head_pos won day-wide and lost 8 of 24 category cells while winning none,
  because it is a *cut* and needs the cap to be binding to substitute. This is a
  *rescue*: it only ever adds words, a tab has the room, so the tabs gain more
  than the day does. **A day-wide win with a category loss means the mechanism
  needs the cap to be binding; a win on both, larger on the tabs, means it does
  not.**
- **`min_standalone` 0.10 → 0.50 (`0019`) and `demote_head_pos` 0.70 → 0.60
  (`0020`) both moved because the rescue invalidated them**, and by the third one
  the pattern was the finding: **a measurement is only valid under the
  circumstance it was taken in, and a clause that admits a *new kind* of word
  invalidates every threshold tuned when that kind could not appear.** The three
  good words `min_standalone` costs are the **조사 blind spot** — Korean attaches
  a particle with no space, so 해남에 scores as a fragment exactly as 도체 inside
  반도체 does. **Do not build a particle-aware variant**: it would rescue three
  bad words and carries no measurement the harness can price.
- **`demote_head_pos` 0.50 scores well and is rejected outright** because it sinks
  폭염 off 2026-07-31's screen. 0.60 is taken over 0.65's marginally better F1
  because it is mid-plateau and a full 0.10 clear of that cliff: **rule 5 is not a
  tie-break to be spent.**
- **The dictionary was re-derived against the new screen** (`0021`, 36
  exclusions) and it is the largest and cheapest of the five, with no threshold
  moved and no signal added. **The eight left in are the point**: 부동산, 아파트,
  에너지, 스마트폰, 무인기, 요양병원, 재선거 and 개정안 can each head a real
  story, and excluding them would be using the dictionary to paper over where the
  good-word line sits — **a labelling question, not a dictionary one.**
- **`min_word_len` rose 3 → 4** (`0022`), where the sequence closes: **the bar was
  doing two jobs**, keeping fragments out and keeping names in, and the rescue
  took the second away, so it can now catch the three-character common nouns it
  had always been set too low to reach. **5 reaches 97% precision and is rejected
  on `shown`** — at 65.8 of 70 places it cannot fill the canvas.

**The decomposition matters more than the total**, and it is measurable only
because `19_rounds_ten_to_twelve_configs.sql` keeps the old sieve as a live row:
run against the *same* dictionary, the three sieve changes are worth +7.9 F1 and
+11.8 precision and the dictionary the remaining +5.0. **Neither figure is the one
you get by reading the commits in order**, because each was measured against the
dictionary of its moment.

**The dictionary is still load-bearing after all of it**: turn it off and the
shipped sieve falls to 50.97 / 73.22 *and drops the day's biggest story on three
of four days*, because 폭염 is two characters, tagged NNG, and lives on its
`allow` entry from `0003`.

**The render cap binds on category tabs after all, and the harness had been
scoring a screen the app does not draw.** `11_category_eval.sql` ranked by
`df desc, word` while `keyword_graph` ranks by the head_pos demotion first — a
disagreement invisible only while a tab draws everything that qualifies.
**2026-08-03 puts 95 to 163 qualifying words on each of its six tabs against a cap
of 70**; seven of the 24 cells bind. Fixing it moved the shipped tab number from
71.80 to 73.21 — a measurement error, not an improvement.

**That undercuts the stated reason head_pos ships as a demotion rather than a
cut.** The argument was "a tab draws at most 46 words, the cap never binds, so a
cut there is loss with nothing to fill the hole". On a fat day the cap does bind,
so a cut there would substitute too. The demotion is not thereby wrong — it still
wins — but **its reason is now only partly right, and the cut-versus-demotion
question deserves re-measuring on fat days rather than being treated as settled**
(`OPEN.md`, item 2). Round fourteen answered half of it in passing: a demotion can
only rescue a mechanism whose losses sit in the non-binding cells.

#### The clauses that are switched off, and the signals that were tried

- **The specificity clause is disabled on purpose** (`min_spec` 9.9, above the
  signal's maximum of 1). Rescuing a word for being confined to one section
  admits exactly the words that mean nothing on their own — 감찰, 윤리, 청문, 초등
  and 순회 all score a perfect 1.00, for the same reason the fragment 알뜰 does.
  Turning it off gained 6.8 and 14.2 F1 points on the two measured days.
- **The neighbours clause is disabled too** (`max_neighbors_per_doc` −1, below
  the signal's minimum of 0), by migration `0009`. Two of sieve 4's three
  rescues are now retired and **the length clause is the sieve**: it admits 68
  of the 70 drawn words, and its precision is the whole sieve's. Do not read that
  as a leak to be plugged. The four signals were measured against the labels
  inside the length group and **not one of them separates its good words from its
  bad** — character length runs the wrong way (bad 3.59, good 3.33), headline
  count is flat, and recurrence across the archive's days is flat too, because at
  three days it measures "story that is still running" rather than "word that
  recurs whatever the news".
- **`head_pos` is the fifth signal and its shape is the lesson** — where in the
  headline the word starts, averaged over the day's headlines holding it, 0
  leading and 1 trailing. Korean headlines are topic-first: a story's names lead
  and generic qualifiers trail. Over 280 drawn word-days the mean is 0.347 for
  good and 0.466 for bad, and above 0.70 it catches almost exactly the family that
  means nothing on its own — 가능성, 시험대, 승부수, 변동성, 무방비, 막바지,
  월요일, 테러범, 수도권. **As a hard cut it was right day-wide and wrong on the
  tabs**, and both measurements are real; it ships as a **demotion**, which
  reproduces the cut's day-wide numbers and leaves the category mean unmoved to
  the decimal. **Do not re-file this as a sieve clause** on the day-wide number
  alone — a day-wide win with a category loss is the signature of a mechanism that
  needs the cap to be binding, and the fix is the mechanism rather than the
  threshold.
- **The dictionary is still doing real work**, and the fifth signal does not
  replace it. With the dictionary off, the demotion is worth about 2.5 mean F1
  on its own — so it is not merely re-catching what `word_overrides` already
  catches — but every dictionary-off configuration still drops the day's biggest
  story on three of four days.
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

#### Round fourteen built three mechanisms, measured them, and shipped one — on a judgement, not on the numbers

Migrations `0023`–`0025` wired a **place gate**, a **render cap the harness can
sweep** and a **category-balance exponent α**, all three switched off pending the
measurement, and migration `0026` is the verdict: **no `value` in
`scoring_weights` moves.** It updates four `note` columns so the deployed
database carries the reasoning. A round that earns nothing has to be as legible
as one that earns something, or the next person re-runs it. The measurements are
in `scripts/analysis/README.md`, "Round fourteen"; what survives here is what
stops a mistake without reading them.

**Migration `0028` then turned the place gate on anyway, and that is the round's
sharpest finding rather than a reversal.** The measurement stands exactly as
`0026` recorded it — the gate costs F1 on both surfaces (day-wide 63.70 → 62.67,
the 24 tabs 78.58 → 75.22) and every one of the eleven words it removes is
labelled good. What overruled it was looking at the screen, where the gate's
absence leaves an unreadable 66-headline "서울 · 광주" as the day's fourth-largest
event — two place names joined to each other and to nothing else, so nothing on
the page can say what those 66 articles are about. The cap and α remain off.

**The harness is the wrong instrument for the question the gate was asked, and
that is the finding to keep.** `analysis.word_labels` answers "is this a word
worth showing"; the gate was asked "can a reader do anything with a word no line
touches", and no label set can price that. **Anything that changes what a word
*means on the page* rather than whether it deserves a place has to be decided by
looking.** It is the same mismatch that stops the harness pricing the render cap.
`word_overrides` mode 'place' is load-bearing rather than a labelled fact in
reserve: its 45 rows are the gate's whole input.

Three standing rules came out of the round, each one general rather than about
its own knob:

- **The place gate's premise failed, not its threshold.** "A place with no line
  to a non-place is backdrop" is false: a place can be the story and hold no
  *drawn* line because its partner sits below the cap. The gate is already at its
  weakest setting, one edge, so there was never a number to retune. **Do not
  re-file it as head_pos and reach for a demotion** — that signature is a
  day-wide *win* with a category loss, this one loses on both, and arithmetically
  a demotion scores 62.88, still under the shipped 63.70. The general form is
  worth more than the case: **a demotion can only rescue a mechanism whose losses
  sit in the non-binding cells.**
- **`10_sieve_eval.sql` structurally cannot price the render cap.** F1 rises
  monotonically with it — 63.70 / 66.38 / 70.60 / 73.80 at 70 / 85 / 100 / 130 —
  because the recall denominator is fixed at every labelled-good word with
  `df >= 3` while the cap *is* the screen size, so the optimum sits at the edge of
  any sweep and the limit of the metric is "draw every word that qualifies".
  Precision reads a fixed screen honestly and decides: **93.53 at 70 against 85.40
  at 130.** **The tell is the shape: a monotone column with no interior turn.**
  Any future knob whose sweep looks like that should be suspected of the same
  defect before its best cell is believed. A cap change is also a canvas change
  and needs `scripts/layout/` re-run. `20_unlabeled.sql` joins **each
  configuration's own `render_cap`** rather than a literal 70, or a sweep would
  promote words it is structurally unable to see.
- **α is not measurable on this day set, which is not the same as α costing
  something.** `df_balanced(α) = Σ_c df_c × (N̄ / N_c)^α`, so the shipped
  configuration (α = 0) enters its own sweep as the control. The only day it
  loses on collected 150/149/150/150/150/150 in a single capped run, so its
  balance factors sit within 0.6% of 1 and there is nothing there to correct.
  **The day the mechanism was built for is 2026-08-04 and it could not be an
  evaluation day while it was still collecting** — rule 4's second trigger. Two
  properties are worth carrying: **the denominator is the word's own section
  distribution, not its top category** (a single denominator would charge 폭염 the
  largest divisor and put the day's biggest story at risk), and **α is the
  identity inside a category tab, at every α, by construction** — so
  `11_category_eval.sql` is the round's **control**, and its 78.58 moving would
  mean α had reached a scoped count where it should have been day-wide.

**Where the harness's own numbers may and may not be read.** Two rules, both
already paid for:

- **F1 is not comparable across days of different thickness.** Recall is the
  drawn good words over every good word with `df >= 3`, so a fat day has a much
  larger denominator while the screen still holds 70 — 2026-08-03's good pool is
  129, against recall of 36.4%. A thick day therefore scores *worse* on F1 while
  showing strictly more of the news.
- **No figure here is comparable to one quoted elsewhere or to an earlier figure
  in this file's history.** The label set has been extended eight times and each
  extension moves every percentage. **Compare configurations against each other
  inside one run, never against a number someone wrote down.**

Two tells about labelling came out of the largest of those extensions, and both
are reusable because both name a *kind* of word:

- **A section tag is not a subject.** 북리뷰, 주末머니, Y녹취록, 뉴시스Pic,
  배틀라인, 이슈톺, 손바닥, 종합2 all reached the screen and all are the
  newspaper's own furniture — every headline carrying one *ends* in it, in
  brackets. The signature is `spec` 1.00 together with a shared bracketed suffix,
  and it is worth checking before labelling a confident-looking 1.00.
- **The operational form of the good/bad line is a question**, and it settles the
  hard cases where the prose definition does not: *would this word appear in a
  randomly chosen other week's news?* 압수수색, 유상증자 and 본회의 would, every
  week, so they are bad however particular the story that produced them.
  문자통보, 미장착 and 보릿돌교 would not. Measured three times: moving a handful
  of words across the line changes the percentages by one to four points and has
  **never once changed which configuration won** — see the README's Labels
  section for the three sittings.

`08_labels_after_dedup.sql` is itself rule 4 firing from the other side:
`02_sieve_configs.sql` was untouched, but migrations `0007` and `0008` moved the
data underneath it and `20_unlabeled.sql` returned eight words that had never been
near the cut before. **Run it before the harness, every time, whatever changed.**
### Why the graph is cached, and what that costs when you retune

**`keyword_graph` was failing for concurrent readers, and the failure was a
server-side 500 rather than slowness.** `anon` carries `statement_timeout = 3s`
(`authenticated` 8s). Measured against the live project on 2026-08-07, a day
holding 3,224 headlines: one call returned 200 in 2,637 ms, and **five
concurrent calls all returned 500 with SQLSTATE `57014`.** A handful of
simultaneous visitors on a thick day each got an error page. `e2e/smoke.spec.ts`
had been red for exactly this reason — Playwright runs five workers against the
real project — and raising its timeout did not help, because the request was not
slow, it was refused.

Two changes followed, and the order matters because only the second one fixed
the problem.

- **Migration `0031` removed a duplicate edge pass.** The place-gate loop's last
  pass computes the converged nodes and edges, finds nothing to drop, and exits —
  and the old final block then recomputed both with the identical `banned`.
  `keyword_graph_pick_edges` ran **three** times where two were needed. Warm,
  second of two runs: **2,425 ms → 1,976 ms**, about 18%, with all **56** cells
  (8 collected days × the all view and 6 tabs) byte-identical before and after.
  Worth having, and **it does not solve the concurrency failure** — five
  concurrent two-second queries still exceed a three-second wall.
- **Migration `0032` stopped computing the graph per request.** The result is a
  pure function of `(date, category)` and that day's stored rows, and those rows
  only change when the collector runs, so recomputing it on every page load was
  the actual defect. `keyword_graph_cache` is keyed `(collected_date,
  category_slug)`; `keyword_graph` reads it and falls back to
  `keyword_graph_compute` on a miss. Same 56 cells byte-identical. Read time
  warm, second of two: **1,976 ms → 1.35 ms**, and the five concurrent calls that
  had all returned 500 now all return **200 in ~0.5 s with identical payloads**.

**A miss does not write the cache, deliberately.** Writing would need
`SECURITY DEFINER`, which would let `anon` trigger unbounded ~2-second writes
through PostgREST. A miss is slow but correct, which is the right direction to
fail in. `refresh_keyword_graph_cache(p_date)` is the writer, `SECURITY DEFINER`
with `set search_path = ''` and execute granted to `service_role` alone — the
same shape and the same reasoning as `refresh_word_directory()` in `0030`.

**Store it as `json`, never `jsonb`.** This was found by the byte-identity check
rather than reasoned: `jsonb` canonicalises key order, so the first draft of
`0032` silently changed all 56 hashes while returning semantically identical
data. `json` is a verbatim passthrough. Anything that round-trips this payload
has to preserve it exactly, because the frontend's cache compares object
identity and the e2e suite asserts on drawn geometry.

**The cost was that a retune stopped being live, and migration `0034` closes
that gap rather than merely documenting it.** For one release cycle this file
said thresholds in `scoring_weights` and the dictionary in `word_overrides` can
be retuned with an `update` and no redeploy, and that had quietly stopped being
true of the *screen* — until `refresh_keyword_graph_cache` was called by hand
for the affected dates, the cached graph stayed the one computed under the old
settings. `keyword_graph_config_fingerprint()` (`0034`) hashes every row of
both tables that can change the drawn graph — a denylist of `note` (both
tables) and `created_at` (`word_overrides`), so a column added later is covered
without editing the function, the same inversion this file already records for
the compound-merge rule. `keyword_graph_cache` carries a `config_fingerprint`
alongside its `graph`, and `keyword_graph` now serves a cached row only when
that fingerprint still matches the current one — a retune is reflected on the
very next read, at the cost of roughly doubling a cache hit (measured warm,
second of two runs: 1.35 ms → ~3–6 ms, against ~2 s to recompute, which is what
makes checking on every read affordable). `keyword_graph_cache_health` (`0033`)
now calls a fingerprint mismatch `stale` too, so `refresh_stale_keyword_graph_cache`
heals the affected dates' cache rows within a run or two with no operator step
at all — `docs/DEPLOYMENT.md`'s "call `refresh_keyword_graph_cache` by hand
after a retune" instruction is gone, not merely relocated. `note` is excluded
from the hash for the same reason migration `0026` exists: it edits four `note`
columns and deliberately moves no `value`, and hashing documentation would
invalidate every cached cell for a comment edit.

**Anything that asks "what does the configuration produce" must call
`keyword_graph_compute`; only the app may call `keyword_graph`.** This sentence
first appeared here claiming the harness was unaffected because it calls the
helpers directly. That was written without checking and was false: two scripts
called the RPC itself, and both were switched.

- `scripts/analysis/30_word_scores.sql` — its `chk` column cross-checks its own
  copy of the sieve against the drawn node list, and its contract is
  two-valued: agreement, or `!` meaning *the script* is wrong. Reading the cache
  adds a third meaning — "the cache predates the last retune" — and a check with
  three meanings and two symbols is not a check.
- `scripts/layout/pullFixture.mjs` — a layout fixture has to be the graph the
  current configuration draws, or every number `scripts/layout/measure.ts`
  prints is measured against a picture the sieve no longer produces.

`10_sieve_eval.sql`, `11_category_eval.sql` and the worklists were already safe:
they call `keyword_signals` and the ranking helpers, never the RPC. The general
rule is the one in bold, not the list.

### Reading the same view twice costs nothing

`src/lib/queryCache.ts` sits under eight of the query functions (count them —
`grep -c "= cachedQuery(" src/lib/queries.ts`; this number has twice been
incremented from a stale one instead of counted — `searchWords` is the eighth,
added for word-directory search) and holds the
**promise**, not the result, keyed on the arguments (TTL 5 minutes, 40 entries —
24 until the headline panel learnt to hold up to `HISTORY_WINDOW` days open at
once, which alone can exceed the old cap; rejections evicted immediately so
"다시 시도" really retries). Two things follow that are easy to underrate:

- **The point is object identity, not the network.** `App.tsx` compares
  identities everywhere — `graph`, `graphWords`, `partition.graph === graph`,
  `eventCounts.of === eventGraph`. Handing back the same object skips the label
  measurement, the Louvain partition, the 300-tick simulation, the edge routing
  **and** the follow-up round trips, and the event list appears without its
  one blank frame. Measured on a tab round trip A→B→A: 6 requests on return
  became 0; on a date step there→back, 9 became 0.
- **That measurement predates search, and search is why eviction is no longer
  oldest-inserted.** `searchWords` and the trajectory fetches add one entry per
  distinct term and one per word looked up, and a session that searches a
  handful of words can add more entries than a plain tab/date round trip ever
  did. Evicting the oldest-inserted key would throw away exactly the
  keyword_graph/share promises the "6 requests → 0" measurement rests on in
  favour of whatever was searched most recently, so eviction is
  least-recently-**read**: a hit moves the entry to the end of the `Map`
  (insertion order becomes read order), while `at` — and therefore the TTL —
  stays pinned to when the request went out, never to when it was last read.
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

**The tab row is the canvas's colour key.** Section ink appears in the words, in
the dot on the tab that filters for them and — since the day's section share was
added — in the donut's arcs, and `src/lib/sectionColors.ts` is the one definition
all three read. A key that names a different green from the one on screen is
worse than no key, so `e2e/keywordGraph.spec.ts` asserts the tab dot and the word
resolve to the same rgb, and the arc is selected by `data-section` rather than by
position so a fixture reweight cannot silently point the assertion at another
section.

**The donut is the first place those inks are used as areas, and the `dataviz`
skill's own validator fails them there.** Run against the six section colours as
chart fills it reports adjacent CVD separation ΔE **1.4** (deutan) and a
normal-vision worst pair of **8.9**, both below its floors. **Acting on that
would be the bug.** These are canvas *text* first, held by `theme.test.ts` to
4.5:1 on the ground and 40° of hue — a stricter bar that pulls the opposite way
from the chroma a fill wants — and this file's own ruling is that a key naming a
different green is worse than no key. The debt was paid in the escape the skill
itself names, **redundant encoding**: every legend row states name, share and
count in ink text, a flagged row says so in words for a screen reader, the arcs
are separated by a 2px surface gap centred on the true boundary, and the svg is
`aria-hidden` so nothing is announced twice. **Nothing on that chart carries
identity by colour alone.** A section smaller than the gap still gets a
`MIN_SWEEP` mark at its true centre — "0.2% of the day" and "absent" must not
look alike on a chart about proportions. If a section ink is ever retuned the
donut is now a constraint that did not exist before, though a weaker one than
`theme.test.ts`.

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

**Every number in this section comes from `scripts/layout/`, and its README is
where the tables live.** What is kept here is what stops a mistake without
reading one. That README is also stamped with the sitting each table was taken
in, because this branch was bitten three times by figures written down without
theirs — **numbers from that harness are comparable only to other runs of it.**

**The layout is two stages, and there is no global simulation.** This was one
`forceSimulation` over all 70 words, and the trouble with it was structural
rather than a matter of tuning. A day is not a hairball: it is eight to a dozen
constellations of three to eight words plus 14–26 words holding no edge at all.
The global sim knew none of that, and `isolatedRings` sent the edgeless words to
rings at 0.36–0.52 of the *short side* — inside the canvas — so unrelated words
sat between the events and every edge had to cross somebody else's story.

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
  silently: 22 of 37 drawn. That is the cohesion-at-0.35 failure below returning
  by a different door. Slack is cheap because `crop` sizes the region, not the
  box.
- **Edgeless words are scattered into the gaps between the regions, and the
  invariant that makes that safe is an ordering rather than a tuning**
  (`scatterLoose`). They used to go to a band *below* the packed regions — never
  to a ring inside them, which is what emptied the middle — and the band is still
  there as the graceful degradation. What changed is that **edges are routed
  first and their curves are then obstacles**: each curve's `CURVE_STEPS` samples
  are stamped into an 8px occupancy grid alongside the anchored labels, and a
  loose word may sit anywhere its label box touches no marked cell. **`crowded`
  therefore cannot rise**, and that is provable rather than measured: `routeEdge`
  now receives a strict *subset* of the obstacle list it used to get, so no route
  could change. **If `crowded` ever does rise here, that is a broken
  implementation and not a trade.** What is bought is height, down 5.6–17.4%
  everywhere. The curves are not re-routed around the scattered words, and that
  is symmetric rather than a shortcut: those words were placed to miss the
  curves, so the curves already miss them.

  The band path takes zero words on all eight cells but stays live and is
  unit-tested at 200px, where six of six loose words are stranded — it is the
  kind of path that rots, so do not "simplify" `flowRows` away.
- **A stranger may not sit inside somebody else's story, and the numbers rather
  than taste settled that.** With in-region placement allowed the strangers
  concentrated in the day's biggest event on **every one of the eight cells** —
  the largest crop box holds the most interior slack. That is **the convex-hull
  failure running backwards**: the blobs were removed because a hull swallows
  whatever lies between an event's members, and here the words were being put
  there on purpose. A region is read from the whitespace around it and nothing
  else, so a foreign word in that whitespace erases the only thing saying
  "different story". Region rectangles are stamped into the same occupancy grid,
  and **blocking them cost nothing** — every column and every height identical to
  the decimal. `inRegion` stays in the harness at 0 for the same reason the sieve
  harness prints `unlabeled`.
- **Bridged events are packed next to each other** (`orderForPacking`). Ordering
  by area alone sent one bridge diagonally across the frame: edge length maxed at
  719px against 208 before the rewrite. Ordering greedily by ties to what is
  already placed brought it back to 228–337.
- **Height is an output, not an input.** `LayoutOptions` has no `height`;
  `bounds.height` is the answer. `MIN_HEIGHT`/`MAX_HEIGHT`/`HEIGHT_RATIO` and the
  whole `NARROW_WIDTH`/`NARROW_HEIGHT_PER_WORD` branch are gone. That branch
  existed because inventing a height from the width gives a phone a box far too
  small — 358×279, which the collision pass cannot resolve, and 2026-07-31 really
  did draw one overlapping pair there. Not inventing a height removes the problem
  rather than compensating for it.

**Three columns were each found not to be one thing, and every one of those
splits overturned the diagnosis it was made under.** This is the section's
recurring lesson, and it is why the harness prints the splits at all:

- **`crossings` splits into `xIn`/`xBr`.** The region rewrite dropped `crowded`
  on all eight cells while raising total `crossings` on three — because the
  remaining crossings had moved *inside* single dense events, and crossings
  between unrelated stories were gone. **Do not read the flat total as "no
  change".**
- **`xBr` splits three ways** (`scripts/layout/bridges.ts`): bridge×bridge,
  bridge×**own** region's inner edges, bridge×another region's. Across eight
  cells nearly all of it is the middle one — a bridge cutting its own event's
  spokes on the way out, which `orderForPacking` cannot touch, because a word
  sitting mid-box crosses its event whichever way it leaves. **A change that
  claims to move `xBr` has to show the split**, or it has not shown the cause.
- **`xIn` splits into forced and left-there** (`scripts/layout/planarity.ts`,
  which reports each event's planarity and, if not, its **skewness** — the floor
  on that event's crossings under *any* drawing). Six events once drew 30
  crossings against a summed floor of 2, and five of the six were flat-drawable
  all along, which is why sweeping `LOCAL_SLACK` and running `untangle` had moved
  none of them: **the tool was wrong, not the setting.** Neither edge counting
  nor subgraph search answers this — K3,3 clears the 3n−6 bound comfortably, and
  the Petersen graph is non-planar while holding K5 and K3,3 only as
  subdivisions. Both are in `planar.test.ts` for that reason.

The two fixes those splits pointed at:

- **`faceBridges` is a mirror, and it was chosen for a property rather than a
  score.** It flips each region within its own box (identity / horizontal /
  vertical / both, cheapest total bridge length, to a fixed point). Reflection is
  an isometry, so the box keeps its size — no re-packing — and it **cannot change
  `xIn` or `overlap` at all**, since those depend only on distances inside the
  region. A lever that can only move the thing it was built for has no regression
  surface to guard. `FACE_ROUNDS` (4) is slack, not a tuned number: it converges
  in one. One cell regresses, instructively — the cost is **length, not
  crossings**, so shortening one bridge can drag another's exit across more
  spokes. Switching the objective to a crossing count was measured and declined.
- **`layoutCluster` draws an event flat when it can**, via
  `src/components/planar.ts`: Tutte's barycentric solve over a fixed convex outer
  boundary, with the non-planar case handled by dropping the smallest edge set
  that makes the rest planar and laying those edges back on top. **It computes no
  planar embedding** — it tries short cycles as candidate boundaries and returns a
  drawing only after verifying on the original edges that nothing crosses and no
  two points coincide. Failing to find a drawing that exists costs nothing, since
  the force layout is still there; returning a wrong one would, and this way round
  cannot. Three things had to be measured rather than reasoned:
  - **Tutte coordinates are unusable as drawn.** They need 3-connectivity, so the
    graph is triangulated first — which hangs ten points inside one face and wants
    31x the area at 13 words. Scaling to separate labels is safe, since crossings
    are similarity-invariant, but 865px became **7,377px**.
  - **Seeding the force simulation from the flat drawing does nothing at all.**
    300 ticks walk back to the same minimum. A force layout does not remember
    where it started. **Do not re-run this experiment.**
  - **Bounding each step does work.** Cap a vertex's move at a third of its
    distance to the nearest edge it does not touch and no edge can cross another
    (PrEd's argument). And spreading and scaling **solve different days**, so both
    are candidates and the winner is measured per event.

  The area a flat drawing may cost is priced **per crossing removed, and that
  price must be a condition of entry**: applied to the winner instead, the
  candidate that removes the most crossings wins and is then disqualified, taking
  the affordable one with it.

**`PLANAR_AREA_PER_CROSSING` is a threshold, not a dial, and that is the whole
character of it.** Its sweep is a staircase — 0.15/0.25/0.35 drew the days
identically to having no planar path at all, 0.5 bought the entire move, 1.0 and
2.0 are the same picture — so there is no middle setting and **the harness cannot
settle it; it is a judgement about the picture.** It is 1.0, and it stays 1.0.

It fired in the costly direction once: 2026-08-02's biggest event grew by one
word and three edges when the sieve improved, the budget refused it a flat
drawing, and it now draws 40 crossings against a floor of 2. `layoutCluster`
verifies a candidate before returning it, so those 40 cannot be a bad flat
drawing — they are the force layout, which is what a refusal falls back to.
**Raising the constant was then measured and declined**, and the reason is the
one this file already states one section down about the canvas, firing here about
a *region*: **widening buys nothing inside a fixed container.** At any k that
admits it, the drawing is **2,864px wide on all three views**, and the svg is
drawn at its own size and then scaled to fit — so `MIN_FONT_SIZE` 14 renders at
1.8px on a phone, 5.0 on desktop and 7.8 on the wide box. It removes 33 crossings
from one event and takes the legibility of all 69 words on the day.

**The harness could not see that until `scripts/layout/measure.ts` grew a `width`
column**, which it now has. A change that widens reads as "uses more room" in a
height-only table and as "shrinks the type" in the real browser, and those are
different problems. Two more corrections came out of the same instrumenting: ten
of the twelve candidates are rejected for **overlap** rather than by the budget,
and `forced` is 52 rather than the 40 the metric reports (`xIn` counts crossings
among *drawn* edges; `forced` counts every edge in the event), so the budget at
1.0 already allows **46x** and the flat drawing simply wants 58x. **Whatever is
tried next, the thing to change is not the constant but what the budget measures**
— area against the force layout, where the price is actually width against the
view. Numbers in `scripts/layout/README.md`, "평면화 가격 — 닫힘".

**When that table went stale, the first diagnosis was the wrong one, and how it
was settled is the reusable part.** Migration `0024` had reordered exactly-tied
edges, so it looked like the culprit. **The leg that settles it is the one that
does not depend on sampling**: no edge reordering can add a *word* to an event,
and the event had gained one. The old order was decided by a query plan and
cannot be replayed, so the sampled leg — permuting the tied edges eight ways per
cell — is **a sample of the space, not a span of it**, and it moved no metric
column anywhere. What actually invalidated the table is `min_word_len` 3 → 4
changing which 70 words are drawn, and "which words" and "therefore which edges"
cannot be separated, because edges exist only between drawn words. That is
migration `0007`'s recorded trap, unchanged.

- **Shelves wrap like a snake, and the packing order was never the problem.**
  `orderForPacking` puts bridged events next to each other, and the shelf wrap
  then split that pair across the full width of the canvas — the two boxes
  deliberately made adjacent ending up as far apart as possible. That was a 703px
  bridge that `OPEN.md` had written off as unfixable. Mirroring odd shelves takes
  it to 274px and its `xBr` to 0, with no constant involved. **First-fit packing
  is measured and declined**: reclaiming the row a two-word event wastes saves
  5–11% of the phone's height but raises bridge crossings, because going back to
  fill an earlier shelf is the same act as separating the neighbours
  `orderForPacking` just placed. A wasted row is cosmetic; a bridge cutting
  through another story is not.
- **The pass condition is written in terms of `xIn`/`xBr`, never total
  `crossings`.** `overlap` is the only column with an absolute rule: never above
  0.

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
- **Widening buys nothing — *inside a fixed container*.** The svg is drawn at its
  own cropped size and then `max-w-full` scales it down to the container, so
  spreading sideways shrinks everything by the same factor. **Growing the
  container is a different act and it does buy something**, which is why the graph
  has its own `max-w-[1600px]` box while the prose keeps its measure: the layout
  runs at a larger width, so there are fewer shelf rows and less is scaled away.
  Measured at 1600 against 1024, every column about the lines is identical,
  `overlap` is 0, and height falls **26–41%** on all four days. `<main>`'s
  `max-w-6xl` moved down onto the masthead and the error block,
  `KeywordGraph.tsx`'s own `max-w-5xl` had to come off too or the change would
  have been a no-op, and the event list keeps 1024. **1600 is not a measured
  number** — height falls monotonically with width, so this harness cannot choose
  a stopping point; past it the minimum font size and the reading distance decide.
  `GraphSkeleton` carries the same cap, because when the two disagreed the canvas
  jumped ~570px wider the moment loading ended — the exact page-jump the skeleton
  exists to prevent.
- **`h-auto` on the svg, not `max-w-full` alone.** The element carries `width`
  and `height` attributes, so capping the width leaves the height at the box the
  layout ran in and the drawing is letterboxed inside it. That put a 141px band
  of empty canvas above and below the graph on a phone.
- **A resize under 8px does not re-run the layout** (`nextLayoutWidth`), and the
  width feeding it goes through `useDeferredValue` so a re-layout does not block
  paint. Dragging a window edge from 1280 to 358 at 6px a frame ran 154 layouts
  and now runs 76. The 8px is invisible because the svg is drawn at its own size
  and then scaled by `max-w-full`.
- **`rectCollide` is not where the layout's time goes**, and it looks like it
  should be. Hoisting the outer node's fields out of the inner loop and dropping
  the `?? 0` guards (every node is seeded with x/y/vx/vy, so they never fired)
  produced a bit-identical picture — coordinate sums matched to four decimals —
  and a time inside the noise, 38.3ms against 38.7ms on the same fixture. The cost
  is d3's own forces across 300 ticks, so **anything that actually moves this
  number changes the picture. Do not re-run this experiment.**
- **The region rewrite is what made it cheaper**, and by construction rather than
  by tuning: the simulation runs per event instead of over the whole day, so the
  biggest collision pass is 14 nodes and 91 pairs a tick rather than 70 and 2,415.
  One global layout was 48 ms; the region layout is 6.8–20.9 ms across the eight
  cells and 13.5–24.0 ms with the scatter. The scatter grows with canvas *area*,
  so the 1600px box is the sensitivity to watch, and the resize path still re-runs
  the whole layout every 8px.

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
and today is empty until the day's first cron, now 03:00 KST. Two things there were settled
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

### A word's trajectory

Everything above terminates inside one `collected_date`. `src/lib/history.ts`
(`buildHistory`) is the one axis that crosses days: clicking a word in the
headline panel draws a sparkline of its share of each collected day, above the
headline list, drawn by `src/components/WordHistory.tsx`.

**The y axis is share, and this is `surge.ts`'s rule extended rather than a new
decision.** Days run 691 to 4,218 headlines and 2026-08-07 is on top of that a
collect-cap regime boundary (150 → 300), so a raw-count series draws collection
depth rather than news. `src/lib/share.ts` holds `count / headlines` once,
because `surge.ts` and `history.ts` both need it and a second copy is how they
would drift apart — `computeSurges` was refactored to call it. Which category
tab is on screen decides what is *shown*, never what a word *did* that day: the
trajectory is day-wide whatever tab is active, the same rule the surge
comparison and the sieve already follow.

**It costs no migration and no new query function.** `fetchWordCountsFor(dates,
words)` already issues `.in('collected_date', …).in('word', …).is('category_slug',
null)` — passing every collected date and the one clicked word returns one row
per day the word appeared on. Naming the word is what already keeps this inside
PostgREST's 1,000-row cap ("name the words you want", above); a trajectory asks
for exactly one, so it was never at risk. The denominators need no new request
either — `App.tsx` already holds them, from `collected_dates`, for the surge
comparison. Nothing here is a summed response: counts are `fetchWordCountsFor`'s
named rows and the denominator is `collected_dates`'s `count(*)` per day.

**Events get no trajectory.** Event identity across days is undefined in this
codebase: the Louvain partition is computed fresh per day (`graphLayout.ts`) and
`mergeCommunities` runs on one day's edge list. There is no way to say
yesterday's 전당대회 event and today's are the same event, so nothing draws a
line between them — the trajectory only ever attaches to a word.

**It only became legitimate when the day-boundary stop shipped.** Before that
deploy, 8.4% of a day's rows carried the wrong date (2026-08-07: 141 of 1,821
rows from that day's four old-code crons were published on another day; 0 of
937 after). A line drawn across days that are 8% mis-dated would have plotted
the collector's schedule, not the news — see "The day boundary" under the Edge
Function section.

`HISTORY_WINDOW` is **14** collected days, ending at the day on screen. It is a
readability cap on a 320px panel — past a couple of weeks the points stop being
distinguishable and the line says less rather than more — **not a measured
number**, and it does nothing yet: the archive is 8 days long.

**The axis carries each point's date and its headline count, and those numbers
measure a different thing from the height they sit at.** That is the one
uncomfortable fact about this chart and it is stated on screen rather than
designed away: 폭염 is 194 headlines on 2026-08-07 and 185 on 08-04 — nearly the
same — while those days hold 2,949 and 4,218 headlines, so the shares are 6.6%
and 4.4% and **the smaller count sits visibly higher**. Putting counts on the y
axis is what the rule above forbids; labelling the points with shares would stop
answering "몇 건". So both are shown and the caption names which is which. Read a
sparkline whose labels and heights disagree as working, not broken.

Labels are **thinned rather than sized down**: `LABEL_SLOT` (34 units) is the
narrowest column a label may occupy, and the stride is derived from it, so at
today's 8 points every point is labelled and at `HISTORY_WINDOW`'s 14 every
other one is. The stride is anchored on the **last** point, so the day on
screen is labelled at any spacing. The svg is 276 units wide because the panel
is `sm:w-80` less `p-4` — 288px — and a `viewBox` scaled by the default
`preserveAspectRatio` against a fixed height renders 1:1 inside that, so those
coordinates are real pixels.

**The headline list below is the same day set, one row per collected day the
word appeared on, each opening and closing independently.** The rows are the
trajectory's points read top-down instead of left-right, newest first, and an
open row holds that day's articles. It is an accordion rather than one long
date-separated list because **the list cannot hold the archive**: 폭염 is 952
headlines over nine days and 973 noun rows, so a single multi-day fetch would sit
on PostgREST's 1,000-row cap and be truncated with nothing saying so — the
failure this file already forbids twice. **One request per open day** is bounded
by construction, is the fetch that already existed, and is already cached per
day, so reopening a day is a cache hit and raises no skeleton
(`fetchHeadlinesForWord.isReady`, the same trick `loadGraph` uses). Loading and
errors are per day for the same reason.

**The panel opens with every day closed**, and that is a request rule as much as
a display one: nothing is fetched until a day is opened. It used to open the day
on screen automatically, which meant clicking any word cost one round trip
whether or not the reader wanted that day's articles.

**A day the word never appeared on gets no row at all** — 8월 3일 is followed
directly by 8월 1일. This removed code rather than adding it: the disabled
control, the "기사 없음" marker, and the exemption that had to keep an *open*
absent day usable are all gone, because an absent day can no longer be open.
**The trajectory still plots those days**, and that asymmetry is the point — a
zero-share day is part of the line, and dropping it turns "the word was not there
that day" into "that day did not happen". Only the list drops them.

**Do not store the open day as a single string.** That was the shipped bug:
pressing an open row called `onOpenDate` with the value it already held, so
nothing changed, and the only way to close a day was to open a different one —
there was no way to reach "all closed" at all. A set makes the toggle and the
empty state expressible; a string cannot represent either.

**"Has the trajectory arrived" is asked once**, in `historyReady`, and the
question is load-bearing twice over: the pre-arrival empty array read as "no rows
to draw" would both fetch the day on screen (undoing the rule above) and, for one
frame, draw the *previous* word's date rows under the new word. It was asked in
two places first, and a mutation test showed that either copy alone was
unkillable because the other one covered for it.

**Opening a day does not move the day on screen.** Same judgement as search not
moving it: the canvas, the date input and the URL all stay put while the panel
reads other days. Which days are open is not in the query string either, for the
reason the event list's expansion is not — it is not a shareable claim about the
data.

**No count is written on a date row, and that is a scoping decision rather than
a layout one.** The trajectory's counts are day-wide by the rule above, while
the list is scoped to the active category tab, so a header reading "51건" over a
40-row list is what writing it there would produce. The day-wide numbers live on
the chart's axis, where the caption says what they count; the panel heading's
count is always **the number of rows currently laid below it** — the open days'
lists summed, which is why it simply disappears in the all-closed default rather
than needing a rule of its own.

**A word that appeared on no collected day in the window falls back to the flat
list.** `historyWindow` covers *collected* days and the day on screen may be
today before the first cron, in which case there are no rows to draw and every
headline would silently vanish. Reached only by search, so it is exactly the kind
of state nobody clicks into by accident.

**`HEADLINE_ROW_LIMIT` was 200 and had quietly stopped being a safety net.** It
is documented as "far above any real value" because the sort runs after the
fetch, so a limit that ever bites changes the list silently. Measured on the
live archive 2026-08-08, worst `(word, day)` cell: **폭염 on 2026-08-07 returns
198 rows** for 194 distinct headlines — two rows of headroom. Nothing had moved
in the panel; `collect_cap` went 150 → 300 and the day went to 4,218 headlines
under it. The biggest word takes about 4.7% of a day, so **the number that moves
this limit is the collect cap**, and it is now 600 — three times the measured
worst, which covers another doubling of the cap. Same shape as `MAX_LIST_PAGES`
in the collector: a second limit nobody chose, surfacing as a short list rather
than as anything named.

### The word directory

The canvas draws at most `render_cap` (70) words a day; the archive holds
19,767 distinct words across eight days. Nothing before this could confirm a
sieve-cut word exists at all, let alone find it. `src/components/WordSearch.tsx`
is a debounced (250 ms) substring box beside `CategoryTabs`; `searchWords` in
`src/lib/queries.ts` reads `word_directory` (migration `0030`), a materialised
view of one row per word ever analysed — `word`, `total` (`count(*)` over its
noun rows), `days` (`count(distinct collected_date)`), `last_date`
(`max(collected_date)`). Selecting a result does `setSelectedEvent(null)` then
`setSelectedWord(word)` and **does not move the date** — the day on screen
stays put, and if the found word is not in that day's `graph.nodes` the
headline panel says so rather than jumping the reader's view out from under
them; the trajectory is what tells them which day to go to.

**Three measurements decided this needs a materialised view rather than a
query.** `word like '김%'` against `headline_nouns` directly: **316 ms**, a seq
scan of all 114,457 noun rows. Restricted to one day: **20 ms** — the seq scan
is unchanged, only the join to `headlines` shrinks, so narrowing the date does
not fix it. Against the materialised directory, `ilike '%민석%'`, second of two
runs in both cases: **60.0 ms cold, 35.0 ms warm** — still a 9x win over the
archive-wide scan, though a smaller one than an earlier draft of the design spec
claimed (that draft's "~1 ms" was inferred from a query plan rather than
measured, and was corrected in
`docs/superpowers/specs/2026-08-07-word-history-and-search-design.md` once the
live number came back; `word_directory`'s own migration header already carried
the right figure, 34.8 ms, from the start). **The number that matters was never
the absolute figure**: `headline_nouns` grows with **headline volume**
(~1.3M rows at 90 days), `word_directory` grows with **vocabulary**, which grows
far more slowly — a new day is mostly words already present. 19,767 rows at
eight collected days. `pg_trgm` was considered and rejected: not installed, and
weak on 2–4 character Korean words regardless.

**`word_directory` has no RLS**, and that is a genuine exception to "all tables
have RLS" — see the Access model section, which now says so too.
`refresh_word_directory()` is `SECURITY DEFINER`; same section explains why
that does not contradict the `keyword_graph`-chain rule.

**Wildcards are stripped from a search term, never escaped.** `%` and `_` are
LIKE wildcards, and PostgREST rewrites a literal `*` into `%` before Postgres
ever sees the pattern, so escaping correctly would mean escaping at two layers
with two different rulesets — one rule in one place is simpler and was checked
rather than assumed safe: of 19,767 words, **two** contain `%` (`0.45%포인트`,
`1%포인트`) and **none** contain `_` or `*`, and both of the affected two remain
reachable by searching `포인트` instead. Left unstripped, a lone `_` would match
every one-character word in the archive.

**The collector refreshes the directory at the end of every run**
(`refresh_word_directory()`, one RPC call in `index.ts` after all six sections
are stored) and reports `directory: 'ok' | 'failed: …'` in the response
body — the only machine-readable channel out of this function, same reason the
per-category `(scrape Xms, process Yms)` timings ride along in that body. A
failed refresh does not fail the run: search staying one run stale is a far
smaller fault than a collection that silently stopped storing headlines. **This
does not touch the CPU budget that kills the function.** A refresh is database
work the worker waits on — wall clock, not accumulated CPU — the same
distinction the run-budget section draws about ETRI's old wait. Verified live:
a deployed run returned `"directory":"ok"` and took the directory from 19,767
to 19,904 rows.

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

The function paginates each section's "더보기" endpoint to
**`scoring_weights.collect_cap`** headlines (150), six sections per run. The cap
is a database value rather than a constant because two things have to agree
about it — the collector, which enforces it, and the reporting that says whether
a section hit it — and because it can then be retuned with an `update` and no
redeploy. `index.ts` reads it once at the top of `Deno.serve` and puts it in the
response as `cap`, so a run's own summary says what it ran with.

The coercion is `lib/collectCap.ts`, on the runtime-agnostic side, and it is not
ceremony: `Number(row?.value ?? 150)` — the obvious one-liner — turns a row whose
`value` is null into a cap of **0**, a run that scrapes nothing and reports six
successful categories. `null` is the one shape that silently zeroes; `undefined`,
`'many'`, `{}`, `-1` and `0` each fail their own way and are all equally
unusable, which is why the resolver covers shapes rather than one value. A
default exists so a failed read cannot silently collect nothing, and the read is
wrapped in a `try` so a thrown rejection — as opposed to postgrest-js's usual
`{ data: null, error }` — cannot abort the handler before the category loop.

**`MAX_LIST_PAGES` is a second cap and it used to override the first without
saying so.** At 8 pages a section stops at ~298 headlines (46 + 36×7) whatever
`collect_cap` says — a limit nobody chose, invisible because it surfaces as a
short scrape rather than as anything named. It is 12 now, reaching ~440, past any
cap measured here. A database value is only a decision if nothing else silently
binds first.

**It is now the thing to check when `collect_cap` is raised**, and the arithmetic
moved: with the day-boundary stop dropping off-day articles, a page contributes
fewer than 36 kept headlines near the boundary, so 12 pages is comfortable at a
cap of 300 and **not enough at 600**. Raise them together or the cap silently
stops meaning what it says again.

**The limit that kills this function is CPU time, not the wall clock, and every
number in this section used to be written against the wrong one.** The platform
allows roughly **3 seconds of accumulated CPU per worker** and says so in the
logs — `CPU Time exceeded` — before returning 546 WORKER_RESOURCE_LIMIT with no
body at all. A 45s run has died where a 64.6s run passed. **The "3 seconds" is a
quoted figure and not one anything here measured** — no endpoint an agent can
reach exposes a CPU number. What is established is the *shape*: cumulative per
worker, and insensitive to a single run's depth up to a cap of 441.

**"Per worker" is load-bearing and had been read as "per request" every time it
mattered.** The budget is *cumulative across the requests one worker serves*, so
the same call can pass and fail with nothing about the call changing. Measured on
2026-08-04: a cap-441 scrape-and-analyse of 2,630 headlines returns 200 on a
fresh worker and 546 as a later call on a warm one, and the analyser probe's
ladder from earlier the same day — `reps=1` 200, then `reps=2,3,5,7,10,40` all
546, in call order rather than in order of work — is the same artefact rather
than a size limit. **The practical consequence is that a 546 is evidence about
the worker, not about the run**, and that a collect-now button is exactly the
shape that trips it.

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
`CHK <category> scraped/processed` lines for that case — **but those are
dashboard-only.** The Management API's log endpoint answers 403 for
`function_logs`, and the MCP `get_logs` tool returns the request-level rows
(`execution_time_ms`, status) without the console output, so nothing an agent can
reach shows a `CHK` line. That is why the two phase timings are in the response
body as well: `(scrape Xms, process Yms)` per category is the only machine-
readable statement of where a run's time went.

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

**Raising the cap was re-tested, and CPU is not what stops it.** The
300-over-12-pages failure was diagnosed twice and wrong twice — first as a wall
near 63s, then as this function's own CPU cost. A probe that scrapes and analyses
exactly as `index.ts` does and writes nothing reaches cap 441 / 2,630 headlines in
5.3s wall and returns 200, which is the **all-new** case a live run cannot be made
to take on demand. The table is in `supabase/functions/collect-headlines/README.md`.

#### The day boundary, and why one cap cannot serve both ends of the day

**What used to stop a raise was the date stamp, and it no longer does.**
`collected_date` is the day of collection and a deeper page is an older article,
so a window wider than the day's own news files yesterday under today.
`fetchSectionHeadlines` now refuses to return anything published on another day,
and that — not the CPU budget, which was tested and fits — is what makes the cap
movable.

**It was not a cost of raising the cap. It was already happening at 150**, and
the two ends of the day say opposite things about that one number. Before 07:00
not one section publishes 150 articles, so at 03:00 a 150-headline window spends
133 of its slots on yesterday in politics and 149 in `it`. Between 07:00 and
11:00, **42.9% of the day's articles were never collected at all.** So 150 is
simultaneously far too wide for the thin hours and less than half of what the busy
ones need, and **the boundary stop is what lets one number stop being asked to do
both**: in the thin hours it stops the scrape early, in the busy hours it never
fires. The cap is then free to rise for the case that actually wants it. It went
to **300** on 2026-08-07 — deliberately not the top of the measured column, since
450 puts a cold all-new run past the deepest scrape ever measured here and the
worker budget is cumulative. **The boundary stop had to be deployed first**: at
150 the early runs already overshoot, and at 300 they would overshoot twice as far.

Live before/after inside 2026-08-07: the day's four old-code crons stored 141
rows published on another day out of 1,821 (**8.4%**), and the two runs after the
deploy stored **0 of 937**.

**2026-08-07 is a collection-regime boundary and days must not be compared across
it.** A day collected at 300 is roughly half as deep again as one collected at
150, and F1 is not comparable across days of different thickness. The four
labelled evaluation days all predate it. The surge comparison is unaffected — it
divides by each day's own total, which is exactly what a step change in depth
needs.

**The one thing lost is real and small.** Those ~129 rows a day are genuine
articles, and they are now not collected at all rather than collected under the
wrong date. **Stamping rows by publication date instead would keep them, at the
cost of a closed day's totals changing afterwards** — which invalidates every
measurement taken against that day and is exactly the hazard rule 4 exists for.
Not done.

**The date is read off the thumbnail path, not off the visible timestamp**
(`/image/origin/{press}/2026/08/05/…`). The visible one is relative — "2시간전",
"1일전" — so it needs a clock and a time zone to become a date, it is hour-grained,
and past a day it stops resolving at all: three ways to be wrong about precisely
the articles the field exists to identify. The thumbnail path is a pure function
of the HTML, which is also what keeps `lib/headlines.ts` testable without a clock.
Coverage is 99.7% over 676 items, and a missing date **keeps** the article — the
same fail-open choice `canonicalLink` makes.

**The per-article date and the paging stop are separate mechanisms, and page 1 is
why.** A section's first page opens with a curated headline block that is *not* in
publication order — politics once had three 08-04 articles inside its first 46
under a cursor still stamped 08-05 — so a rule that stopped at the first old
article would have cut that page off at rank 3. `cursorIsBefore` stops the *paging*
once a whole page's oldest article predates the day; `published` filters *within*
every page, including that one.

It was checked against the page cursor and then **against the articles
themselves**, and only the second can establish this is a *publication* date
rather than merely a self-consistent one: the twelve politics articles straddling
the boundary were fetched and their own timestamps read, 12 agree and 0 disagree.
Agreeing with the cursor would have been satisfied by any date the same pipeline
stamped on both.

**Note that deeper paging widens the section gap rather than closing it**, and
**collection cannot be equalised by paging deeper at all**: on 2026-08-04 society
took its whole window twice while `it` never passed 98 on any of five runs. The
thin section is not being truncated — it publishes less — so a deeper page adds
rows where there are already rows. Migration `0025` took the balance into the
ranking instead (`df_balanced`); round fourteen then measured that it cannot be
priced on the day set the archive has.

The move to six runs a day is what settled the `min_headlines` question — see the
round-seven section of `scripts/analysis/README.md`. The short version: on a thin
day the word at rank 70 has three headlines, so a floor is the screen; on a fat
day it already has eight, so a floor of 4, 5 or 6 never reaches it. **A promotion
floor is unnecessary rather than deferred**, and `min_headlines` stays at 3 as a
safety net for a day whose collection failed.

Nouns are fetched *before* the headline row is inserted, so a failure leaves
nothing behind and the next run retries naturally. The duplicate path also
backfills headlines that somehow have no nouns.

#### What the thicker day costs the graph, and the two errors made measuring it

All-categories first paint was near-linear in the day's headline count —
2,103 / 2,614 / 3,299 ms at 2,197 / 3,077 / 4,218 headlines before migration
`0029`, and 1,515 / 2,080 / 2,600 ms after it. **A reader arriving today pays none
of that**: `0031` took the computation down another 18% and `0032` stopped doing it
per request at all, so a cached read is **1.35 ms** and a real page's first paint
measures **~0.57 s** even on 3,224 headlines. Those figures are now the cost of a
cache *miss*, and of `keyword_graph_compute` when the harness calls it directly.
See "Why the graph is cached" for why that growth was not merely slow but was
breaking the site for concurrent readers.

The cost was `keyword_signals`, 2,034 ms of the 4,218-headline day's 3,299, and it
is called exactly once per request since `0024`, so there was no repeated call to
remove. `0029` took it to 1,276 ms **without moving a single one of its ten output
columns on any of the eight collected days** — checked by running the pre-`0029`
definition beside the new one as `keyword_signals_old` and taking a symmetric
`except` over all ten columns: 0 differing rows across 41,142 word-rows. **The
useful part is which of three candidates survived measurement:**

- **The neighbour count now comes out of `pairs`** — the same self-join the
  association signal already runs — instead of a second one of its own. Worth
  **414 ms**.
- **`standalone` is handed its rows ordered by word.** The regex pattern is built
  per row and varies by word, and Postgres keeps only a small compiled-regex
  cache, so unordered input recompiles on nearly every row. Worth **183 ms**, and
  it is an `ORDER BY` and nothing else.
- **Hoisting `regexp_replace` out of the row loop does nothing, and it is the
  obvious fix.** Building the pattern once per distinct word rather than per doc
  row should cut a 524 ms node by 3.4x. Measured: 1,900 ms against a 1,903 ms
  baseline. **The cost is the *match*, not the building.**

**Two measurement errors were made getting there and both are worth not
repeating.** The per-CTE timings were first taken by retyping each CTE as a
standalone query — and the standalone regex came out differently escaped, so it
measured a cheaper pattern at 103 ms where the real node is 524 ms. The same
sitting also read a cold-cache first query (583 ms) as a signal when the warm
value was 93 ms. Both are why the attribution that survived comes from running the
deployed function's **own body** as a plain query — a `language sql` function with
`RETURNS TABLE` is a black box to `EXPLAIN` otherwise — and why every timing here
is the second of two runs.

Nothing on the frontend hides a wait of this size: the skeleton, the `preconnect`
and `main.tsx`'s pre-mount request all help the *first byte* rather than this.

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

Every function on the `keyword_graph` chain is `SECURITY INVOKER` with
`set search_path = ''`, so it is the *calling* role's privilege that is checked
and a `SECURITY DEFINER` anywhere on it would hand out the service role's view of
the tables. `keyword_signals` and `category_balance_factors` are granted to
`anon, authenticated` because a signature change drops the function and discards
its old grant; `authenticated` is an empty role here — there is no login — so
naming it moves nothing about the access model and only keeps one chain
consistent with itself.

**`word_directory` (migration `0030`) is a genuine exception to "all tables have
RLS", not an oversight.** It is a materialised view, and a materialised view
cannot carry a policy at all — Postgres has no `ALTER MATERIALIZED VIEW … ENABLE
ROW LEVEL SECURITY`. Its whole access model is therefore the grant: Supabase's
default grants are wide, so the migration revokes everything from `public,
anon, authenticated` first and then grants `select` back to `anon,
authenticated` explicitly, rather than assuming the wide default is what is
wanted. `refresh_word_directory()` is `SECURITY DEFINER`, and that does **not**
contradict the `keyword_graph`-chain rule above: `refresh materialized view` is
an owner-only operation, the migration runs as the owner, and the Edge Function
connects as `service_role` rather than the owner — without the definer it could
not refresh at all. What the chain rule protects is a function handing `anon`
the service role's *view of the tables*; this function reads nothing and
returns nothing, so there is no view to hand out. It still takes
`set search_path = ''` on principle, and execute is granted to `service_role`
alone — never `anon`, which over PostgREST would let anyone queue unbounded
~300 ms refreshes (the cost of rebuilding the directory, not of searching it —
see "The word directory" below for that number).

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
  silently never appeared. `CATEGORY_SHARE` is one of those, and like
  `COLLECTED_DATES` it is **derived from `HEADLINE_COUNTS`** rather than written
  out beside it, since a drifted copy would describe a day that does not exist.

Two failures this suite has caught that no unit test could, and they belong
beside the `expect(skeleton).toBeHidden()` note above because they are the same
shape — an assertion that cannot fail, and an assertion that agrees with the code
rather than with the browser:

- **A test group passed with its own invariant deleted.** The scatter's two
  guards — curves stamped as obstacles, regions kept out — were both removed and
  all 43 tests still passed, including the two written to catch exactly those
  mutations. The sampling was right; the *fixture* was too sparse. At 6 linked
  and 6 loose words the canvas is empty enough that "the cell farthest from
  anything already placed" misses the curves and the regions whether or not they
  are stamped, at every width from 300 to 900. Replaced with roughly the real
  ratio — **14 linked words across three events with a bridge between each pair,
  plus 20 loose words, run at two widths** because one width can be luck — and
  then verified by mutation one gate at a time: removing the curve stamping fails
  **exactly** the edge test at 550 and 600px and nothing else, removing the
  keep-out fails **exactly** the region test, both restored 46/46. A fixture that
  fails everything would prove no more than one that fails nothing. **Mutation is
  what found this; nothing about the test's text was wrong.**
- **A percentage split agreed with itself and disagreed with the browser.** The
  first largest-remainder implementation compared floating-point fractional
  parts, and 4/12 against 1/12 — mathematically both exactly one third — differ
  in their last bits, so which section received the spare percent was decided by
  rounding noise: **the browser drew 33% where the unit arithmetic said 34%.**
  Only the e2e run saw it. It is integer quotient and remainder now, and the test
  pins the whole distribution `[34, 25, 17, 8, 8, 8]` — a weak "does it sum to
  100" assertion passed against the buggy version too.

A third, smaller: **the donut made `svg path` stop meaning "an edge"**, and one
`toHaveCount(1)` assertion had been passing only in the frame before the donut
existed. Both bare selectors are now scoped to `svg[role="group"]`.

**The sparkline's axis labels are the same hazard on the other selector**: since
the trajectory gained date and count labels, `svg text` no longer means "a drawn
word" whenever a headline panel is open. Every current use survives only because
it is filtered by the word (`hasText: /^예산안$/`) or narrowed to
`svg text[role="button"]`, and the one bare `.first()` runs with no panel open.
A future bare `svg text` count is the third time this trap will have been set.

**`headline_nouns` in the mock had to stop being a constant.** It answered the
same rows for every date, so once the panel could open another day, "opening
yesterday shows yesterday's articles" was an assertion nothing could break. It
now filters on `headlines.collected_date` and `headlines.categories.slug` —
PostgREST spells an embedded filter as the dotted path in the query string — and
`HEADLINE_ROWS` carries one yesterday row, its count taken from what
`WORD_COUNTS` already says about that day rather than invented. Same rule as
`COLLECTED_DATES` and `CATEGORY_SHARE`: a fixture that describes a day
differently from the fixture beside it describes a day that does not exist.
Verified by mutation — dropping the date filter fails two tests, and pointing
`App.tsx` at the day on screen instead of the day the panel has open fails one.

`e2e/smoke.spec.ts` is the only file that hits the real project, and it asserts
the seeded category tabs rather than collected words — nothing exists for the
current date between midnight and the day's first cron at 03:00 KST.

`e2e/smoke.spec.ts` needs a real `.env` (recoverable with
`npx vercel env pull .env --environment=development`); on a fresh clone without
one, `npm run test:e2e` fails 1 of 43 with a bare count mismatch. Also note
`playwright.config.ts` sets `reuseExistingServer: true`, so a dev server started
before `.env` existed will be silently reused with stale environment variables —
stop it first. It also pins the viewport to 1280×900, so **the suite says nothing
about the graph's 1600px box**: it never exercises it above 1232px, and that
width rests on `scripts/layout/`'s `wide` view plus a one-off DOM measurement.

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
  `20_unlabeled.sql` after any edit to `02_sieve_configs.sql` or
  `24_cap_and_place_configs.sql`** and label what it finds. That fired three
  times in one sitting.
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

**A round's rows are cheap to leave behind and are not free.** Round fourteen's
live in `24_cap_and_place_configs.sql`, which also carries the `render_cap` and
`balance_alpha` columns the harness sweeps, and `active` is narrowed to the
shipped row at the end. Every extra active α value costs one `keyword_signals`
call a day — the same file's own sitting measured `10_sieve_eval.sql` at 6.2s
with one α, against a previous sitting's 24.8s with five (two sittings, so only
the *shape* is comparable: the cost tracks the distinct α count, not the
configuration count). Worse than the seconds, **every active row carries a
permanent rule-4 obligation**, because a later collection can promote a word onto
*its* screen and the worklist will then demand it be labelled before any row can
be read.

`30_word_scores.sql` and `31_fragments.sql` are the other half: they explain one
day's screen word by word rather than comparing configurations. **They are
diagnostics and never grounds for moving a threshold** — that is still
`10_sieve_eval.sql`'s job, and adjusting a number because one day's dump looks
wrong is the habit the rules above exist to stop. `30`'s `chk` column cross-checks
its own copy of the sieve against `keyword_graph`'s node list and prints `!` on
disagreement, for the same reason the harness prints `unlabeled`; a `!` means the
script is wrong, not the sieve.

**That cross-check has now earned itself twice, and its second catch says how
long a drift can hide.** `30`'s copy of sieve 4 never gained the `min_proper`
clause when migration `0018` shipped it, so for four rounds it reported every
proper-noun rescue as "cut: generic" — a `!` on every word admitted by
`passed_by = 'proper'`. Fixed in that file; the sieve was never touched. **Note
what `chk` still cannot see**: it asks whether a word *may* be drawn, never why
it placed where it did, so sieve 6 and the α ordering are both invisible to it. A
round that turns the place gate on has to add that clause by hand, because the
cross-check will not demand it.

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
