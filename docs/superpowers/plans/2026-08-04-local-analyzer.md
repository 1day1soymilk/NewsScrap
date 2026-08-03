# Local Korean analyser — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ETRI's per-headline HTTP call with `garu-ko` running inside the
Edge Function, and re-analyse the whole archive so it comes from one analyser.

**Architecture:** `lib/nouns.ts` stays runtime-agnostic and takes plain tokens
(`{text, pos, start}`) plus the original title; the Garu instance is built once
per run in `index.ts`. Eojeol boundaries come from the title's own whitespace
instead of ETRI's `word` spans. The archive is re-analysed locally and written
through the Management API, so no re-analysis endpoint is left in production.

**Tech Stack:** Deno (Supabase Edge Functions), `npm:garu-ko@0.9.12` (MIT, WASM,
1.4MB model), Vitest, Postgres via the Supabase Management API.

## Global Constraints

- `supabase/functions/collect-headlines/lib/*.ts` must stay runtime-agnostic:
  **no `Deno.*`, no `npm:` specifiers, no Deno globals.** That is what keeps them
  testable under Vitest on Node.
- `index.ts` is **not type-checked** (tsc cannot resolve Deno globals) and has no
  unit tests. Its correctness is established by deploying and reading the
  response `summary`.
- `npm run build` is the real gate — it type-checks `src`, `vite.config.ts` and
  the function's `lib/`. `npm test` alone passes on code that does not compile.
- Never put `SUPABASE_*` variables in `.env.functions`; Supabase reserves the
  prefix and that file becomes the function environment.
- All tables have RLS with select-only policies. **Do not add write policies.**
  The service-role key exists only in the Edge Function environment.
- Arbitrary SQL goes through the Management API
  (`POST https://api.supabase.com/v1/projects/{ref}/database/query`). There is no
  local Postgres, Docker or Deno in this environment.
- Nouns are NFC-normalised. **NFC, never NFKC** — NFKC would rewrite ￦, ①, ㈜ and
  the halfwidth forms these headlines genuinely use.
- Work on a branch. Do not merge; the user merges to `main` himself.

---

### Task 1: Prove garu-ko loads under Deno

Nothing else in this plan is worth starting until this passes. This environment
has no Deno, so the only way to know is to deploy and run.

**Files:**
- Create: `supabase/functions/analyzer-probe/index.ts`

**Interfaces:**
- Produces: the knowledge of which load path works. Task 3 uses that path.

- [ ] **Step 1: Write the probe**

`supabase/functions/analyzer-probe/index.ts`. It tries three load paths in order
and reports which one worked, so one deployment answers the question completely.

```ts
// A throwaway. Deleted in Task 3 once the working path is known.
Deno.serve(async () => {
  const title = 'SK하이닉스 상한가…반도체 무인기 소동'
  const attempts: Record<string, string> = {}

  // Path 1 — the node entry. npm packages sit on disk under Deno, so its
  // fs/promises reads of the wasm and the model may simply work.
  try {
    const { Garu } = await import('npm:garu-ko@0.9.12')
    const g = await Garu.load()
    attempts.node = g.analyze(title).tokens.map((t) => `${t.text}/${t.pos}`).join(' ')
  } catch (e) {
    attempts.node = `FAILED: ${String(e)}`
  }

  // Path 2 — the browser entry with the model supplied as bytes, so only the
  // wasm is left to wasm-bindgen's own fetch.
  try {
    const { Garu } = await import('npm:garu-ko@0.9.12/browser')
    const { readFile } = await import('node:fs/promises')
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const modelPath = require.resolve('garu-ko/models/base.gmdl')
    const modelData = (await readFile(modelPath)).buffer
    const g = await Garu.load({ modelData })
    attempts.browser = g.analyze(title).tokens.map((t) => `${t.text}/${t.pos}`).join(' ')
  } catch (e) {
    attempts.browser = `FAILED: ${String(e)}`
  }

  // Path 3 — drive the wasm-bindgen glue directly, supplying both the wasm and
  // the model as bytes. Nothing is left for either entry point to resolve.
  try {
    const glue = await import('npm:garu-ko@0.9.12/pkg/garu_wasm.js')
    const { readFile } = await import('node:fs/promises')
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const wasmBytes = await readFile(require.resolve('garu-ko/pkg/garu_wasm_bg.wasm'))
    const modelBytes = await readFile(require.resolve('garu-ko/models/base.gmdl'))
    await glue.default(wasmBytes)
    const instance = new glue.GaruWasm(new Uint8Array(modelBytes), false)
    attempts.glue = JSON.stringify(instance.analyze(title)).slice(0, 300)
  } catch (e) {
    attempts.glue = `FAILED: ${String(e)}`
  }

  return new Response(JSON.stringify(attempts, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 2: Deploy it**

```bash
set -a && . ./.env.supabase && set +a
npx supabase functions deploy analyzer-probe --project-ref "$SUPABASE_PROJECT_REF"
```

- [ ] **Step 3: Run it and read the answer**

```bash
curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/analyzer-probe" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Expected: at least one of `node`, `browser`, `glue` holds a token string
containing `SK하이닉스/NNP` and `반도체/NNG`.

**If all three say FAILED, stop and report.** The design does not survive and
the fallback is a new ETRI key. Do not proceed to Task 2.

- [ ] **Step 4: Record which path won**

Note it in the branch's first commit message. Task 3 uses exactly that path.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/analyzer-probe/index.ts
git commit -m "Probe whether garu-ko loads under Deno"
```

---

### Task 2: Extract nouns from garu tokens

**Files:**
- Modify: `supabase/functions/collect-headlines/lib/nouns.ts`
- Modify: `supabase/functions/collect-headlines/lib/nouns.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AnalyzedToken { text: string; pos: string; start: number }
  export function extractNouns(title: string, tokens: readonly AnalyzedToken[]): string[]
  export function filterNouns(words: string[]): string[]   // unchanged
  ```
  `extractNouns` now takes the title as well, because eojeol boundaries are read
  from its whitespace. `callEtriMorphAnalysis` and every `Etri*` type are deleted.

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe('extractNouns')` and `describe('callEtriMorphAnalysis')`
blocks in `nouns.test.ts` with these. Keep `describe('filterNouns')` exactly as
it is — that function does not change.

```ts
import { describe, expect, it } from 'vitest'
import { extractNouns, filterNouns } from './nouns'
import type { AnalyzedToken } from './nouns'

// garu returns character offsets rather than morpheme ids, so a fixture is just
// the title plus the tokens in order. `at` keeps the offsets honest by finding
// each token in the title itself.
function tokens(title: string, spec: [string, string][]): AnalyzedToken[] {
  let cursor = 0
  return spec.map(([text, pos]) => {
    const start = title.indexOf(text, cursor)
    cursor = start + text.length
    return { text, pos, start }
  })
}

describe('extractNouns', () => {
  it('collects NNG and NNP', () => {
    const title = '여야 예산안 처리'
    const result = extractNouns(title, tokens(title, [
      ['여야', 'NNG'], ['예산안', 'NNG'], ['처리', 'NNG'],
    ]))
    expect(result).toEqual(['여야', '예산안', '처리'])
  })

  it('merges inside one eojeol but never across a space', () => {
    // 보완수사권 is one eojeol and must come back whole; 완전 박탈 is two.
    const title = '보완수사권 완전 박탈'
    const result = extractNouns(title, tokens(title, [
      ['보완', 'NNG'], ['수사', 'NNG'], ['권', 'XSN'],
      ['완전', 'MAG'], ['박탈', 'NNG'],
    ]))
    expect(result).toEqual(['보완수사권', '박탈'])
  })

  it('leaves the inflectional suffixes out of the merge', () => {
    // 적 makes 기록적 an adnominal where 기록 is the keyword; 들 makes 개미들
    // a second word for 개미.
    const title = '기록적 개미들'
    const result = extractNouns(title, tokens(title, [
      ['기록', 'NNG'], ['적', 'XSN'], ['개미', 'NNG'], ['들', 'XSN'],
    ]))
    expect(result).toEqual(['기록', '개미'])
  })

  it('ends the run at a bound noun', () => {
    // Without this 김민석 측 arrives as 김민석측.
    const title = '김민석측 발언'
    const result = extractNouns(title, tokens(title, [
      ['김민석', 'NNP'], ['측', 'NNB'], ['발언', 'NNG'],
    ]))
    expect(result).toEqual(['김민석', '발언'])
  })

  it('keeps symbols inside the word', () => {
    // SL, SH and SN are part of the word: this is what makes SK하이닉스 and
    // 1군단장 and 李대통령 survive as single words.
    const title = 'SK하이닉스 1군단장 李대통령'
    const result = extractNouns(title, tokens(title, [
      ['SK', 'SL'], ['하이닉스', 'NNP'],
      ['1', 'SN'], ['군단장', 'NNG'],
      ['李', 'SH'], ['대통령', 'NNG'],
    ]))
    expect(result).toEqual(['SK하이닉스', '1군단장', '李대통령'])
  })

  it('splits a run wherever a particle or ending interrupts it', () => {
    const title = '상한가에 반도체가'
    const result = extractNouns(title, tokens(title, [
      ['상한', 'NNG'], ['가', 'JKB'], ['에', 'JKB'],
      ['반도체', 'NNG'], ['가', 'JKS'],
    ]))
    expect(result).toEqual(['상한', '반도체'])
  })

  it('drops runs carrying no NNG or NNP of their own', () => {
    const title = '하였다 예산안'
    const result = extractNouns(title, tokens(title, [
      ['하', 'VV'], ['였', 'EP'], ['다', 'EF'], ['예산안', 'NNG'],
    ]))
    expect(result).toEqual(['예산안'])
  })

  it('returns an empty array for no tokens', () => {
    expect(extractNouns('', [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run supabase/functions/collect-headlines/lib/nouns.test.ts`
Expected: FAIL — `extractNouns` still takes an `EtriResponse`, so every case
errors or returns `[]`.

- [ ] **Step 3: Rewrite `extractNouns`**

In `nouns.ts`, delete `EtriMorpheme`, `EtriWord`, `EtriResponse`,
`ETRI_ENDPOINT`, `callEtriMorphAnalysis` and the old `extractNouns`. Keep
`NOUN_TYPES`, `BREAK_TAG_FAMILIES`, `BREAK_TYPES`, `NON_MERGEABLE_SUFFIXES`,
`STOPWORDS` and `filterNouns` exactly as they are — **and keep their comments**,
which record why each entry is there.

```ts
/** One morpheme as the analyser returns it. `start` is a character offset. */
export interface AnalyzedToken {
  text: string
  pos: string
  start: number
}

function isMergeable(token: AnalyzedToken): boolean {
  if (BREAK_TAG_FAMILIES.has(token.pos[0])) return false
  if (BREAK_TYPES.has(token.pos)) return false
  return !(token.pos === 'XSN' && NON_MERGEABLE_SUFFIXES.has(token.text))
}

/**
 * Which eojeol each character belongs to. Whitespace is -1.
 *
 * The rule has always been that the headline's own spacing says what belongs
 * together — ETRI's `word` spans were a proxy for it. Tokens carry character
 * offsets, so the spacing can be read directly, which is both simpler and
 * closer to what the rule claims.
 */
function eojeolOf(title: string): Int32Array {
  const index = new Int32Array(title.length)
  let current = 0
  let inSpace = true
  for (let i = 0; i < title.length; i++) {
    if (/\s/.test(title[i])) {
      index[i] = -1
      inSpace = true
    } else {
      if (inSpace) current += 1
      inSpace = false
      index[i] = current
    }
  }
  return index
}

export function extractNouns(title: string, tokens: readonly AnalyzedToken[]): string[] {
  const eojeol = eojeolOf(title)
  const nouns: string[] = []
  let run: AnalyzedToken[] = []
  let at = -2

  const flush = () => {
    if (run.some((token) => NOUN_TYPES.has(token.pos))) {
      nouns.push(run.map((token) => token.text).join(''))
    }
    run = []
  }

  for (const token of tokens) {
    const here = eojeol[token.start] ?? -1
    if (here !== at) {
      flush()
      at = here
    }
    if (isMergeable(token)) run.push(token)
    else {
      flush()
      at = -2
    }
  }
  flush()

  return nouns
}
```

- [ ] **Step 4: Run the tests and the build**

Run: `npx vitest run supabase/functions/collect-headlines/lib/nouns.test.ts`
Expected: PASS, all cases.

Run: `npm run build`
Expected: exit 0. This is what type-checks the function's `lib/`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/collect-headlines/lib/nouns.ts \
        supabase/functions/collect-headlines/lib/nouns.test.ts
git commit -m "Read nouns from analyser tokens rather than from ETRI's response"
```

---

### Task 3: Run the analyser inside the collector

**Files:**
- Modify: `supabase/functions/collect-headlines/index.ts`
- Delete: `supabase/functions/analyzer-probe/index.ts`
- Modify: `.env.functions` (remove `ETRI_API_KEY`)
- Modify: `docs/DEPLOYMENT.md`

**Interfaces:**
- Consumes: `extractNouns(title, tokens)` and `filterNouns(words)` from Task 2,
  and the load path Task 1 proved.

- [ ] **Step 1: Load the analyser once per run**

At the top of `index.ts`, replace the ETRI import and key with the analyser.
Use whichever path Task 1 proved; the node entry is written here.

```ts
import { Garu } from 'npm:garu-ko@0.9.12'
import { extractNouns, filterNouns } from './lib/nouns.ts'
```

Delete `const ETRI_API_KEY = Deno.env.get('ETRI_API_KEY')!`.

- [ ] **Step 2: Replace `analyseNouns`**

```ts
// The analyser is loaded once per invocation and reused for every headline in
// the run. Loading is the expensive part — a 1.4MB model and the WASM — and
// analysis itself is 0.79ms a headline, measured over 2,197 real ones.
let analyser: Garu | null = null
async function loadAnalyser(): Promise<Garu> {
  if (!analyser) analyser = await Garu.load()
  return analyser
}

function analyseNouns(garu: Garu, title: string): string[] {
  const normalised = title.normalize('NFC')
  const tokens = garu.analyze(normalised).tokens
  return filterNouns(extractNouns(normalised, tokens))
}
```

`analyseNouns` stops being `async`. Update its two call sites in `storeHeadline`
to pass the instance and drop the `await`, and thread the instance from the
handler through `processHeadlines` into `storeHeadline`.

- [ ] **Step 3: Load it in the handler before the category loop**

```ts
Deno.serve(async () => {
  const startedAt = Date.now()
  const deadline = startedAt + RUN_BUDGET_MS
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const garu = await loadAnalyser()
  // ...
```

- [ ] **Step 4: Deploy and run it**

```bash
set -a && . ./.env.supabase && set +a
npx supabase functions deploy collect-headlines --project-ref "$SUPABASE_PROJECT_REF"
curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/collect-headlines" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Expected: a `summary` with `ok:` lines carrying non-zero `new` counts and
`0 failed` — this is the only check `index.ts` has. Note `elapsedMs`; it should
fall well below the 50,000 budget now that no headline waits on a network call.

- [ ] **Step 5: Verify the rows landed**

```sql
select collected_date, count(*) from headlines
where created_at > now() - interval '10 minutes' group by 1;

select count(*) from headlines h
where h.created_at > now() - interval '10 minutes'
  and not exists (select 1 from headline_nouns n where n.headline_id = h.id);
```

Expected: the first returns today's date with a positive count; the second
returns 0 — every stored headline has nouns.

- [ ] **Step 6: Remove ETRI's remains**

Delete `supabase/functions/analyzer-probe/`. Remove `ETRI_API_KEY` from
`.env.functions` and push the change:

```bash
npx supabase secrets set --env-file .env.functions --project-ref "$SUPABASE_PROJECT_REF"
```

Update `docs/DEPLOYMENT.md` and the `.env.functions` row in CLAUDE.md's
environment table — that file now holds nothing, so say so rather than leaving a
row describing a key that is gone.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Analyse in the function, and drop the ETRI dependency"
```

---

### Task 4: Re-analyse the archive

**Files:**
- Create: `scripts/reanalyze/reanalyze.mjs`
- Create: `scripts/reanalyze/README.md`

**Interfaces:**
- Consumes: `extractNouns`/`filterNouns` from Task 2, imported through the
  type-stripping runner in `scripts/layout/register.mjs`.

- [ ] **Step 1: Install the analyser for Node**

The function resolves `npm:garu-ko@0.9.12` on its own, but this script runs
under Node and needs it in `node_modules`. It is a tool dependency, not
something the frontend ships:

```bash
npm install --save-dev garu-ko@0.9.12
```

Check that `npm run build` still emits the same bundle size afterwards — nothing
in `src/` imports it, so the frontend must not grow.

- [ ] **Step 2: Write the re-analysis script**

`scripts/reanalyze/reanalyze.mjs`. It reads every headline through PostgREST
with the anon key, analyses locally, and writes chunked SQL to a file. **It does
not touch the database** — RLS blocks anon writes and the service-role key is
not here.

```js
// Reads the archive, analyses it with the same code the function runs, and
// emits SQL. Nothing here writes: the anon key cannot, by design.
//
//   node --experimental-strip-types --import ./scripts/layout/register.mjs \
//        scripts/reanalyze/reanalyze.mjs > /tmp/reanalyze.sql
import { readFileSync, writeFileSync } from 'node:fs'
import { Garu } from 'garu-ko'
import { extractNouns, filterNouns } from '../../supabase/functions/collect-headlines/lib/nouns.ts'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
const headers = { apikey: key, Authorization: `Bearer ${key}` }

const headlines = []
for (let from = 0; ; from += 1000) {
  const r = await fetch(`${url}/rest/v1/headlines?select=id,title&order=id`,
    { headers: { ...headers, Range: `${from}-${from + 999}` } })
  const page = await r.json()
  if (!Array.isArray(page) || page.length === 0) break
  headlines.push(...page)
  if (page.length < 1000) break
}

const garu = await Garu.load()
const rows = []
for (const { id, title } of headlines) {
  const normalised = title.normalize('NFC')
  for (const word of filterNouns(extractNouns(normalised, garu.analyze(normalised).tokens))) {
    rows.push([id, word])
  }
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`
const out = ['begin;', 'delete from headline_nouns;']
for (let i = 0; i < rows.length; i += 2000) {
  const chunk = rows.slice(i, i + 2000)
  out.push(
    'insert into headline_nouns (headline_id, word) values\n' +
    chunk.map(([h, w]) => `(${quote(h)}, ${quote(w)})`).join(',\n') + ';',
  )
}
out.push('commit;')
writeFileSync('scripts/reanalyze/reanalyze.sql', out.join('\n'))
console.error(`headlines ${headlines.length}  noun rows ${rows.length}  statements ${out.length}`)
```

- [ ] **Step 3: Run it and check the counts against today's**

```bash
node --experimental-strip-types --import ./scripts/layout/register.mjs \
     scripts/reanalyze/reanalyze.mjs
```

Expected: roughly 5,000 headlines and a noun-row count within a few percent of
what the database holds now. Compare:

```sql
select count(*) from headline_nouns;
```

A count that differs by more than about 10% means the extraction is wrong, not
that the analyser is different — stop and find out which.

- [ ] **Step 4: Apply it through the Management API**

Send each statement in `scripts/reanalyze/reanalyze.sql` in order. The `begin;`
and `commit;` bracket it, so a failure anywhere leaves the old nouns in place.

- [ ] **Step 5: Verify the archive is uniform**

```sql
select count(*) from headline_nouns;
select count(*) from headlines h
  where not exists (select 1 from headline_nouns n where n.headline_id = h.id);
```

And the two invariants CLAUDE.md keeps, both of which must return 0:

```sql
select count(*) from (
  select normalize(word, nfc) from (select distinct word from headline_nouns) t
  group by 1 having count(*) > 1) d;

select count(*) from (
  select category_id, substring(link from '/article/(\d+/\d+)') as k
  from headlines group by 1, 2 having count(*) > 1) d;
```

- [ ] **Step 6: Write the README and commit**

`scripts/reanalyze/README.md` records what was run, the before and after row
counts, and that the archive is now the output of one analyser — which it has
never been.

```bash
git add scripts/reanalyze/
git commit -m "Re-analyse the archive so it comes from one analyser"
```

---

### Task 5: Re-derive the sieve

The words moved, so rule 4 of `scripts/analysis/README.md` fires: label
everything on screen before reading any number.

**Files:**
- Create: `scripts/analysis/14_labels_after_reanalysis.sql`
- Modify: `scripts/analysis/README.md`, `CLAUDE.md`

- [ ] **Step 1: Find the unlabelled words**

Run `scripts/analysis/20_unlabeled.sql` through the Management API. It returns
every word that reaches the screen under any active configuration and carries no
label.

- [ ] **Step 2: Label them**

Write `14_labels_after_reanalysis.sql` in the shape of `13_labels_wider_collection.sql`:
grouped inserts with a comment per group saying which line each group sits on.
A word is good when it names a particular person, organisation, place or event,
and bad when it names a role, a category or a quantity that would read the same
in any week's news. Mark genuinely arguable calls in the `note` column.

Apply it, then re-run `20_unlabeled.sql`. **It must return nothing.**

- [ ] **Step 3: Score the configurations**

Run `scripts/analysis/10_sieve_eval.sql` and `11_category_eval.sql`. Read
`unlabeled` before anything else; if it is not 0 the row is meaningless.

- [ ] **Step 4: Record the numbers**

Update the precision figures in CLAUDE.md's "Word scoring and the keyword graph"
section, and say plainly that they are not comparable to the previous ones —
the analyser changed underneath them. Keep the existing note that F1 is not
comparable across days of different thickness.

**Do not move a threshold in this task.** If a configuration other than the
shipped one now wins, record it and stop; changing the analyser and a threshold
together would leave no way to attribute the difference.

- [ ] **Step 5: Commit**

```bash
git add scripts/analysis/ CLAUDE.md
git commit -m "Re-label and re-score the sieve on the re-analysed archive"
```

---

### Task 6: Re-derive the layout measurements

The drawn 70 words moved, and edges exist only between drawn words, so the edge
set moved too — the trap migration 0007 recorded.

**Files:**
- Modify: `scripts/layout/graphDays.json`
- Modify: `scripts/layout/README.md`

- [ ] **Step 1: Re-pull the fixture**

```bash
node scripts/layout/pullFixture.mjs scripts/layout/graphDays.json
```

- [ ] **Step 2: Re-run the three harnesses**

```bash
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/measure.ts
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/bridges.ts
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/planarity.ts
```

- [ ] **Step 3: Check the invariant and record the table**

`overlap` must be 0 in all eight cells. Judge the rest on `xIn` and `xBr`
separately, never on total `crossings` — the pass condition in
`scripts/layout/README.md`. Add the new table under a heading that says the
archive was re-analysed, and keep the old one for comparison.

- [ ] **Step 4: Run the whole gate**

```bash
npm test          # 264
npm run build     # exit 0
npm run lint
npm run test:e2e  # 42
```

- [ ] **Step 5: Commit**

```bash
git add scripts/layout/
git commit -m "Re-measure the layout on the re-analysed archive"
```

---

### Task 7: Say what the constants no longer stand on

**Files:**
- Modify: `supabase/functions/collect-headlines/index.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Annotate each constant**

None of these changes value. Each gets a note saying its justification is gone
and what would settle it.

```ts
// **This number has lost its reason.** Eight in flight existed because every
// headline waited ~500ms on ETRI; analysis is now 0.79ms and in-process, so
// concurrency buys nothing measurable and may cost. Left alone deliberately:
// moving the analyser and the collector's shape together would leave no way to
// attribute whatever the numbers then do. Measure it on its own.
const ANALYSIS_CONCURRENCY = 8
```

```ts
// **Also unreasoned now.** 50 seconds sat below an observed ~63s platform wall
// that a run of ETRI round trips reached easily. Without them a run should
// finish far inside this, and the budget may be able to go away entirely.
// Check `elapsedMs` in the response before touching it.
const RUN_BUDGET_MS = 50_000
```

```ts
// **The 300-over-12-pages failure needs re-testing.** It returned 546
// WORKER_RESOURCE_LIMIT at 63s, and that was measured with an ETRI call per
// headline — the wall may have been latency rather than the platform. Deeper
// paging may now fit. Note that "a deeper page is older news, a later run is
// newer news" still holds and is about freshness, not cost, so more runs stay
// the better instrument regardless.
const MAX_HEADLINES_PER_CATEGORY = 150
const MAX_LIST_PAGES = 8
```

- [ ] **Step 2: Write down what the next version is for**

In the same comment block in `index.ts` and in CLAUDE.md's "Edge Function run
budget" section:

- **Re-tune collection volume** — the cap, the page count and the concurrency,
  each measured on its own.
- **A collect-now button** in the frontend, so a collection can be taken on
  demand instead of waiting for the next of six crons.
- **Filter duplicate headlines by title.** `UNIQUE (category_id, link)` plus
  `canonicalLink` already stop one article arriving twice, but the same story
  from a different outlet is not caught — 2026-08-01 holds 190 such rows.
  Duplicates inflate co-occurrence, so `edge_min_cooc = 2` can be satisfied by a
  single story collected twice.

- [ ] **Step 3: Update CLAUDE.md's external-services section**

Replace the ETRI entry. Record that the analyser now runs in the function, that
it is `garu-ko` under MIT with a 1.4MB WASM model, the measured 0.79ms against
~500ms, and the comparison that justified the swap — 96% of noun rows identical
and 68 of the drawn 70 the same, with 삼전닉스 and 오늘 the only movers. Keep
the note that Naver RSS is discontinued.

- [ ] **Step 4: Run the gate and commit**

```bash
npm run build && npm test && npm run lint
git add -A
git commit -m "Mark the constants the round trip used to justify"
```

---

## Verification

The whole thing, in order:

```bash
npm test                                    # 264
npm run build                               # the real gate — exit 0
npm run lint
npm run test:e2e                            # 42
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/measure.ts
```

Plus, through the Management API: `20_unlabeled.sql` returning nothing, and both
CLAUDE.md invariant queries returning 0.

And the collector deployed, run, and its `summary` read — the only check
`index.ts` has.

## Where to stop

- **Task 1 fails on all three paths.** Report and stop; the fallback is a new
  ETRI key, which is a different plan.
- **Task 4's noun-row count differs by more than ~10%** from what the database
  holds. That is an extraction bug, not an analyser difference — find out which
  before writing anything.
- **A configuration other than the shipped one wins in Task 5.** Record it and
  stop. Retuning belongs to its own pass.
