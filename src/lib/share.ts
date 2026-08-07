// src/lib/share.ts
//
// A word's share of a day: its headline count over that day's headline total.
//
// **This is a module of its own because two features need it**, and a second
// copy is how the two would drift apart. `surge.ts` established the rule by
// measurement — 2026-08-01 was collected twice and holds 1,144 headlines
// against 2026-07-31's 899, so on raw counts every word looks about 27% up —
// and `history.ts` runs the same comparison across the whole archive, where the
// spread is wider still (691 to 4,218 headlines a day).
//
// It does not live in `surge.ts`, because a trajectory has nothing to do with a
// day-over-day comparison and should not import one; nor in `history.ts`, which
// would be worse in the same way. Same reason `keyword_signals` is not
// reimplemented in a script: one copy of an arithmetic that two callers must
// agree on.

/**
 * `count / headlines`, and 0 when the day has no headlines to be a share of.
 *
 * The guard is not defensive decoration. `NaN` sorts unpredictably and compares
 * false against itself, and `Infinity` would take a sparkline off the top of
 * its box — both would surface far from here as a wrong picture rather than as
 * an error.
 */
export function share(count: number, headlines: number): number {
  return headlines > 0 ? count / headlines : 0
}
