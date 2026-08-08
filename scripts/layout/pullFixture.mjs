// Pulls a set of archived days' keyword_graph into a fixture file.
// Uses the anon key against the RPC, same path the frontend takes.
//
//   node scripts/layout/pullFixture.mjs scripts/layout/graphDays.json
//   node scripts/layout/pullFixture.mjs scripts/layout/graphDays.fat.json 2026-08-04
//
// The days are an argument, defaulting to the four the main table has always
// been measured on. **That default is load-bearing rather than convenience:**
// changing which days the main fixture holds mixes a day effect into every
// before/after comparison taken on it, and edges exist only between drawn
// words, so the mix cannot be unpicked afterwards (migration 0007's recorded
// trap). A day worth measuring separately gets its own file — see fixture.ts.
import { readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')

const out = process.argv[2]
if (!out) throw new Error('usage: pullFixture.mjs <out.json> [day …]')

const days =
  process.argv.length > 3
    ? process.argv.slice(3)
    : ['2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03']

const graphs = {}

for (const day of days) {
  // **`keyword_graph_compute`, never `keyword_graph`.** Since migration 0032 the
  // latter reads `keyword_graph_cache`, so it would hand back whatever was
  // cached at the last collector run. A layout fixture has to be the graph the
  // *current* configuration draws, or every number `measure.ts` prints is
  // measured against a picture the sieve no longer produces — and the whole
  // point of the fixture is that those numbers are comparable to each other.
  const res = await fetch(`${url}/rest/v1/rpc/keyword_graph_compute`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_date: day, p_category: null }),
  })
  if (!res.ok) throw new Error(`${day}: ${res.status} ${await res.text()}`)
  const graph = await res.json()
  graphs[day] = {
    nodes: graph.nodes.map((n) => ({
      word: n.word,
      count: n.count,
      faded: n.faded,
      category_slug: n.category_slug,
    })),
    edges: graph.edges.map((e) => ({ a: e.a, b: e.b, cooc: e.cooc, npmi: e.npmi })),
  }
  console.log(day, graphs[day].nodes.length, 'nodes', graphs[day].edges.length, 'edges')
}

writeFileSync(out, JSON.stringify(graphs, null, 2))
console.log('wrote', out)
