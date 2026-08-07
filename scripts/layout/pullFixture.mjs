// Pulls the four archived days' keyword_graph into a fixture file.
// Uses the anon key against the RPC, same path the frontend takes.
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

const days = ['2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03']
const out = {}

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
  out[day] = {
    nodes: graph.nodes.map((n) => ({
      word: n.word,
      count: n.count,
      faded: n.faded,
      category_slug: n.category_slug,
    })),
    edges: graph.edges.map((e) => ({ a: e.a, b: e.b, cooc: e.cooc, npmi: e.npmi })),
  }
  console.log(day, out[day].nodes.length, 'nodes', out[day].edges.length, 'edges')
}

writeFileSync(process.argv[2], JSON.stringify(out, null, 2))
console.log('wrote', process.argv[2])
