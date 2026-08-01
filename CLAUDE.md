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
is no longer on the graph's path; `fetchWordCounts` is kept for the day-over-day
comparison Phase 3 needs and because the view is the documented way to read counts
without hitting that cap.

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

Measured precision of the top 70 words: 24.3% for frequency alone, 71.4% / 67.1%
for the sieve. Those figures come from `analysis.word_labels` and are **not
comparable to any percentage quoted elsewhere** — a different label set moves them
several points.

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

Collision is rectangular rather than d3's circular `forceCollide`, because a
circle around a wide label is roughly three times taller than the text and leaves
words floating in the gaps.

The layout is deterministic — seeded positions, a fixed tick count, and ties
broken on the word server side — so the same day always renders the same picture
and the e2e suite can assert on it.

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

`e2e/keywordGraph.spec.ts` stubs Supabase at the network layer
(`e2e/support/mockSupabase.ts`), so it does not depend on what was collected that
day. Note that `keyword_graph` is an RPC: it arrives as a POST with its arguments
in the body, so a handler keying off `p_category` must read
`route.request().postDataJSON()`, not the query string. `e2e/smoke.spec.ts` is the
only file that hits the real project, and it asserts the seeded category tabs
rather than collected words — nothing exists for the current date between midnight
and 13:00 KST, when the cron runs.

`e2e/smoke.spec.ts` needs a real `.env` (recoverable with
`npx vercel env pull .env --environment=development`); on a fresh clone without
one, `npm run test:e2e` fails 1 of 11 with a bare count mismatch. Also note
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
