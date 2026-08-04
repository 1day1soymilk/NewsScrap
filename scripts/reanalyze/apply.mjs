// Sends reanalyze.sql to the Management API, one statement per request, in
// order. Split from reanalyze.mjs because this is the half that writes and it
// needs SUPABASE_ACCESS_TOKEN rather than the anon key — keeping the reading
// and the writing in separate files keeps "the analysis cannot corrupt the
// archive" a property of the code rather than a claim about it.
//
//   node scripts/reanalyze/apply.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.supabase', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const ref = env.SUPABASE_PROJECT_REF
const token = env.SUPABASE_ACCESS_TOKEN

const statements = readFileSync('scripts/reanalyze/reanalyze.sql', 'utf8')
  .split('\n@@\n')
  .filter((s) => s.trim())

for (const [index, query] of statements.entries()) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    },
  )
  if (!response.ok) {
    console.error(`statement ${index + 1}/${statements.length} failed: ${response.status}`)
    console.error((await response.text()).slice(0, 500))
    console.error(query.slice(0, 200))
    process.exit(1)
  }
  await response.json()
  console.error(`${index + 1}/${statements.length} ok (${query.length} bytes)`)
}
