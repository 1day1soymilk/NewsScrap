// Reads the archive, analyses it with the same code the function runs, and
// emits SQL. Nothing here writes: the anon key cannot, by design. `apply.mjs`
// is the half that does, and it needs a different credential.
//
//   node --experimental-strip-types --import ./scripts/layout/register.mjs \
//        scripts/reanalyze/reanalyze.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { Garu } from 'garu-ko'
import {
  extractNouns,
  filterNouns,
} from '../../supabase/functions/collect-headlines/lib/nouns.ts'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
const headers = { apikey: key, Authorization: `Bearer ${key}` }

const headlines = []
for (let from = 0; ; from += 1000) {
  const r = await fetch(`${url}/rest/v1/headlines?select=id,title&order=id`, {
    headers: { ...headers, Range: `${from}-${from + 999}` },
  })
  const page = await r.json()
  if (!Array.isArray(page) || page.length === 0) break
  headlines.push(...page)
  if (page.length < 1000) break
}

const garu = await Garu.load()
const rows = []
for (const { id, title } of headlines) {
  const normalised = title.normalize('NFC')
  for (const noun of filterNouns(extractNouns(normalised, garu.analyze(normalised).tokens))) {
    rows.push([id, noun.word, noun.pos])
  }
}

// **The swap is one statement, and that is the whole point of the staging
// table.** The plan for this bracketed the inserts in `begin;` / `commit;`, but
// each Management API request is its own session — a `begin` in one request and
// a `commit` in another bracket nothing, and a failure in between would leave
// the table empty. Filling a staging table over many requests is safe because
// nothing reads it, and the exchange is then a single atomic statement.
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`
const out = [
  `create table if not exists public.headline_nouns_reanalysis (
     headline_id uuid not null, word text not null, pos text);`,
  'alter table public.headline_nouns_reanalysis add column if not exists pos text;',
  'truncate public.headline_nouns_reanalysis;',
]
for (let i = 0; i < rows.length; i += 2000) {
  const chunk = rows.slice(i, i + 2000)
  out.push(
    'insert into public.headline_nouns_reanalysis (headline_id, word, pos) values\n' +
      chunk.map(([h, w, p]) => `(${quote(h)}, ${quote(w)}, ${quote(p)})`).join(',\n') + ';',
  )
}
out.push(
  `with cleared as (delete from public.headline_nouns returning 1)
   insert into public.headline_nouns (headline_id, word, pos)
   select headline_id, word, pos from public.headline_nouns_reanalysis;`,
)
out.push('drop table public.headline_nouns_reanalysis;')

writeFileSync('scripts/reanalyze/reanalyze.sql', out.join('\n@@\n'))
console.error(
  `headlines ${headlines.length}  noun rows ${rows.length}  statements ${out.length}`,
)
