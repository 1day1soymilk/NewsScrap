# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal Naver-news word cloud. A Supabase Edge Function scrapes six Naver news
sections daily, extracts Korean nouns via ETRI's morphological-analysis API, and
stores them in Postgres. A Vite + React frontend reads that data and renders a
d3-cloud word cloud filterable by date and category; clicking a word lists the
headlines it came from.

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

`tsconfig.json` references three projects: `app` (`src`), `node`
(`vite.config.ts`), and `functions` (`supabase/functions/**/lib/**`). Test files
are inside the checked scope on purpose — jest-dom matchers resolve through
`"types": [..., "@testing-library/jest-dom/vitest"]` in `tsconfig.app.json`.

Do not make a build pass by excluding tests from type checking, loosening
`tsconfig`, or weakening an assertion. That has been tried here and it hides real
errors.

### The schema lives in three places

`supabase/migrations/*.sql`, the Edge Function's inserts, and `src/lib/queries.ts`
all encode the same column names. Changing one means changing all three.

The frontend never aggregates in the client and never reads raw rows for counts —
it queries the `daily_word_counts` and `collected_dates` views, which exist so
PostgREST's 1000-row cap cannot silently truncate a result set.

`daily_word_counts` is a `UNION ALL` of a per-category aggregate and an
all-categories rollup keyed by a null `category_slug`. **Do not rewrite it with
`GROUP BY GROUPING SETS`** — that form blocks predicate pushdown, so the planner
aggregates the entire history before applying the date filter. Migration
`0002_word_counts_pushdown.sql` explains the measurements.

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

`WordCloud.tsx` and `App.tsx` have no unit tests: d3-cloud measures text on a
canvas, which jsdom does not implement. Their layout arithmetic is extracted into
`src/components/wordCloudLayout.ts`, which is tested. The rendered cloud and the
`App.tsx` wiring around it are covered by the Playwright suite in `e2e/` instead —
`npm run test:e2e`, which boots its own dev server.

Five of those tests stub Supabase at the network layer
(`e2e/support/mockSupabase.ts`), so they do not depend on what was collected that
day. `e2e/smoke.spec.ts` is the only file that hits the real project, and it
asserts the seeded category tabs rather than collected words — nothing exists for
the current date between midnight and 13:00 KST, when the cron runs.

`e2e/smoke.spec.ts` needs a real `.env` (recoverable with
`npx vercel env pull .env --environment=development`); on a fresh clone without
one, `npm run test:e2e` fails 1 of 7 with a bare count mismatch. Also note
`playwright.config.ts` sets `reuseExistingServer: true`, so a dev server started
before `.env` existed will be silently reused with stale environment variables —
stop it first.

Do not assert a positive total for how many words the cloud rendered. d3-cloud
silently drops words that do not fit the canvas, so totals vary with font
rendering. Asserting that a word is absent (`toHaveCount(0)`) is fine — absence
does not have that problem. Assert that specific words are visible or absent
instead of asserting a count.
