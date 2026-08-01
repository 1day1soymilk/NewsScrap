# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal Naver-news keyword graph. A Supabase Edge Function scrapes six Naver
news sections daily, extracts Korean nouns via ETRI's morphological-analysis API,
and stores them in Postgres. A Vite + React frontend reads that data and renders a
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
| `.env.functions` | `ETRI_API_KEY` | uploaded wholesale as the Edge Function environment |
| `.env.supabase` | CLI access token, project ref, DB password | the Supabase CLI |

Never put `SUPABASE_*` variables in `.env.functions`: that file becomes the
function's environment and Supabase reserves the prefix. The DB password is not
recoverable from the dashboard — `.env.supabase` is the only copy.

Any host serving the built frontend (Vercel and the like) needs
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured there. They are baked
in at build time, and `.env` is not in the repo.

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
file said it was. A day holds 3,289 distinct words (2026-08-01; 2,484 on 07-31), so
an unfiltered read of it returns the top 1,000 and nothing says so. The surge
comparison was written against that mistake and measured: summing the truncated
response for a denominator inflated every ratio by 11% and turned 12 of the 110
drawn words into false "new"s. Two rules follow, and `fetchWordCountsFor` /
`fetchHeadlineCount` in `src/lib/queries.ts` exist to enforce them:

- **Name the words you want** (`.in('word', …)`). The graph draws at most
  `render_cap` (70) of them, so a response bounded by that list cannot be cut.
- **Never sum a response to get a denominator.** Day totals come from a
  `head: true, count: 'exact'` query, which returns no rows at all and so cannot
  be truncated. `computeSurges` takes the total as an argument rather than
  summing the counts it was handed, so the mistake cannot recur by accident.

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

`keyword_signals(p_date)` computes the four per-word signals and is called by
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
of bad word, and averaging dilutes each where it is strong. Ranking is by
frequency alone — the sieve only decides who is drawn, and size stays
proportional to headline count.

Thresholds live in `scoring_weights` and the dictionary in `word_overrides`
(`exclude` / `demote` / `allow`), so retuning needs no redeploy. **Never change a
threshold without running `scripts/analysis/10_sieve_eval.sql` first** (or
`11_category_eval.sql` when the question is about a category tab) — its README
records five ways this has already gone wrong. Note that the labels go stale when
the *data* moves and not only when the sweep widens: collecting a date twice put
13 unlabelled words on screen and silently invalidated a run. Two findings that cost real
time and should not be rediscovered:

- **The specificity clause is disabled on purpose** (`min_spec` 9.9, above the
  signal's maximum of 1). Rescuing a word for being confined to one section
  admits exactly the words that mean nothing on their own — 감찰, 윤리, 청문, 초등
  and 순회 all score a perfect 1.00, for the same reason the fragment 알뜰 does.
  Turning it off gained 6.8 and 14.2 F1 points on the two measured days.
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

Measured precision of the top 70 words on the two labelled days: 24.3% / 28.6%
for frequency alone, 84.3% / 75.7% for the sieve with the dictionary. Those
figures come from `analysis.word_labels` and are **not comparable to any
percentage quoted elsewhere, or to any earlier figure in this file's history** —
the label set has been extended four times and each extension moves them.
Compare configurations against each other inside one run, never against a number
someone wrote down.

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
the top story's blue is now the dot in the caption that names it, and the
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

Three things there were arrived at by looking at real days, not by reasoning:

- **Initial positions are seeded explicitly.** d3-force places any node without an
  x/y on a phyllotaxis spiral centred on the origin — the canvas's top-left — and
  relies on the centring forces to carry it in. At these force strengths 300 ticks
  does not cover half a canvas, so a category with eight words settled up and to
  the left with the rest of the frame empty.
- **`forceManyBody`'s `distanceMax` must stay capped** at half the canvas. Letting
  repulsion act across the whole frame pushes the outermost words into the bounds
  clamp, where they pile up into a column stuck to the wall.
- **The viewport is cropped to the labels**, not to the canvas the simulation ran
  in. Few words cannot generate enough mutual repulsion to resist the centring
  forces, so they clump; cropping beats tuning the forces per node count.
- **Crowding is `DEFAULT_PADDING`, not canvas size.** Raising `MAX_HEIGHT` from
  640 to 820 spread the events apart and moved the mean nearest-neighbour gap by
  half a pixel, because what two adjacent labels rest at is the collision
  padding. Padding is the lever; the taller canvas is what stops the events
  landing on top of each other once they have room. Do not raise padding past
  ~16 either: at 22 a 40-word canvas can no longer resolve its collisions and
  labels overlap, which `graphLayout.test.ts` catches.
- **Widening buys nothing.** The svg is drawn at its own cropped size and then
  `max-w-full` scales it down to the container, so spreading sideways shrinks
  everything by the same factor. Height is the only free axis — on a desktop.
- **`h-auto` on the svg, not `max-w-full` alone.** The element carries `width`
  and `height` attributes, so capping the width leaves the height at the box the
  simulation ran in and the drawing is letterboxed inside it. That put a 141px
  band of empty canvas above and below the graph on a phone.
- **Width is the constrained axis on a phone, and the fix is height.** A 14px
  label is 14px whatever the viewport, so the area 70 of them need does not
  shrink with the screen: at 358px the desktop ratio gives a 358×279 canvas, the
  collision pass cannot resolve that, and the words land on top of each other.
  Below `NARROW_WIDTH` the canvas grows with the word count instead
  (`NARROW_HEIGHT_PER_WORD`), and the page scrolls, which a phone does anyway.
- **The 20 words with no edges are what makes the middle look crowded.** Of the
  70 drawn on 2026-08-01, 20 hold no edge at all and the best-connected word
  holds six — there is no hub, and a single-centre mind map would assert a
  structure the data does not have. Those 20 are pushed out to a band of three
  concentric rings (`isolatedRings`), leaving the middle to the events. The band
  is three rings rather than one circle because a single radius is not long
  enough to hold them side by side, and they stack on it — again caught by the
  overlap test. With nothing connected at all the push is skipped entirely.

Collision is rectangular rather than d3's circular `forceCollide`, because a
circle around a wide label is roughly three times taller than the text and leaves
words floating in the gaps. The box is 1.2x the font size tall, not 1x: `getBBox`
on drawn Hangul spans ascender to descender, and treating the em box as the
collision height left neighbouring rows grazing by a pixel.

**One relationship, one stroke.** Each edge is a single quadratic Bézier that
bows around whatever labels sit in its way. Strength is carried by width and
opacity (`0.9 + 1.3·npmi`), never by the number of strokes.

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

Communities are found from the edge list **before** the simulation runs, since
they depend only on topology. That ordering matters: it lets a cohesion force
hold each event's words together, without which a cluster's members scatter and
the hull drawn around them swallows unrelated words.

**Each event is arranged around its hub** — the member holding the most edges,
ties broken on headline count then on the word so the pick is reproducible.
Cohesion pulls members toward that word rather than toward the centroid. Both
hold a cluster together, but a centroid is an empty point no word occupies, so
the members ring a gap and there is nothing at the middle to read the event
from.

**Clusters are never drawn.** They decide the cohesion force, the hub each event
rings, and which story the caption names — and nothing on the canvas.

They used to be shaded, six of them (`clusterLimit`), and both halves of that
were wrong. Six overlapping washes were the dirtiest thing on screen: a hull is
angular, and where two met the page read as a smudge rather than as two events.
Cutting to one made it worse rather than better, because it turned noise into a
false claim — **a blob is the convex hull of its members' label boxes, so
anything that happens to lie between them is inside it.** On 2026-08-01 the hull
for 트럼프·이스라엘·하마스·압박 also enclosed 폭염, 정청래, 김민석 and 이재명,
four words from other events. A hull is only honest when its members are already
adjacent, which is exactly when it adds least. The caption names the story
instead, and `clusterLimit` still defaults to 1 because that is all the caption
needs; `graphLayout.test.ts` passes it explicitly where the partition itself is
under test.

The layout is deterministic — seeded positions, a fixed tick count, and ties
broken on the word server side — so the same day always renders the same picture
and the e2e suite can assert on it.

### Day-over-day surge

`src/lib/surge.ts` marks the words that gained the most of the day against the
previous **collected** date — not against yesterday, since the archive has gaps
and today is empty until the 13:00 KST cron runs. Two things there were settled
by measurement and should not be re-argued from first principles:

- **Shares, never raw counts.** 2026-08-01 was collected twice and holds 1,382
  headlines against 2026-07-31's 900, so on counts every word is up 50%.
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
sections per run. Every headline costs an ETRI round trip plus a few DB calls, so
the work runs `ANALYSIS_CONCURRENCY` items in flight off a shared cursor, and two
deadlines keep a slow run from being killed mid-flight: `RUN_BUDGET_MS` overall,
divided into a per-category slice so the last sections in the list are not the
ones starved on every slow run. Unprocessed headlines are picked up by the next
run, since duplicates skip ETRI entirely.

Nouns are fetched *before* the headline row is inserted, so a failure leaves
nothing behind and the next run retries naturally. The duplicate path also
backfills headlines that somehow have no nouns.

## External services

- **Naver RSS is discontinued. Never use it.** Headlines come from parsing
  `news.naver.com/section/{id}` HTML plus its `SECTION_ARTICLE_LIST` pagination
  endpoint, which returns the same markup wrapped in JSON.
- **ETRI's old portal `aiopen.etri.re.kr` shut down on 2025-06-30** (its
  certificate has since expired). The successor is
  `http://epretx.etri.re.kr:8000/api/WiseNLU`, same request/response schema,
  5,000 calls/day.

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
  `content-range` header, not from a body.
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
  hypothetical. Judge on F1 and the `heatwave` column together.

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
상한가 or 유조선, because it named the tags allowed to join a run and ETRI tags
those words' prefixes `XPN` and suffixes `XSN`. **Fixed by inverting the rule:**
the headline's own spacing already says what belongs together, so an eojeol is
kept whole and the run breaks only on what is not part of the word. Still open is
the `standalone` cut, which loses more whole words to a following 조사 (유시민,
골리앗, 앤트로픽) than it catches fragments.

The archive **spans the merge's own deploy** — 1,773 of 2,282 headlines were
analysed before it first shipped — so a word count that crosses 2026-08-01 13:00
KST blends two analysers, and the fix above adds a third boundary at its own
deploy. The archived days are not re-analysed.
