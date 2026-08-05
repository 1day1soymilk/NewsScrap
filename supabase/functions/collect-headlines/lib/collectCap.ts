// The per-section per-run scrape cap lives in `scoring_weights.collect_cap`
// rather than in a constant, because two things have to agree about it: this
// function, which enforces it, and the reporting that says whether a section hit
// it. A literal in each place is two copies of one fact and the second goes
// stale silently the moment the first is retuned. Migration 0023 seeded it.
//
// **The coercion is here, on the runtime-agnostic side, and it is not
// ceremony.** `Number(row?.value ?? 150)` — the obvious one line — turns a row
// whose `value` is null into a cap of **0**, which is a run that scrapes nothing
// and reports six successful categories collecting nothing at all. The whole
// point of a default is that a failed read cannot silently collect nothing, so
// the fallback has to cover every shape a bad read can take, not just the
// missing row. That is a decision with cases, which means it is a decision worth
// a test, which is why it sits in lib/ instead of inline in Deno.serve.
//
// PostgREST hands back `numeric` as a string on some paths and a number on
// others, so both are accepted.
export const DEFAULT_COLLECT_CAP = 150

export function resolveCollectCap(value: unknown): number {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_COLLECT_CAP
  return Math.floor(parsed)
}
