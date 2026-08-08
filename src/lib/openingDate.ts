// src/lib/openingDate.ts
//
// Which day the app opens on when the URL does not name one.
//
// **The morning screen was near-empty and it was not a collection fault.**
// Measured on the live archive 2026-08-08: at 03:00 KST the day holds 198-237
// headlines and its pool of words with `df >= 3` is **59-81, below the render
// cap of 70**, so the canvas cannot fill however it is drawn. Not one Naver
// section publishes 150 articles before 07:00 (the table in the collector's
// README), so no deeper page and no larger `collect_cap` reaches this — today's
// news is not written yet. The only honest answer is to open on a day that has
// one, and to say on screen that today is still filling.
//
// This is a display rule and nothing else. It never changes what a day *holds*,
// only which day the reader lands on with no `?date=` to go by, and a shared
// link always wins.

import type { CollectedDate } from './queries'

/**
 * A day is worth opening on at this fraction of a normal day's headline count.
 *
 * **Measured rather than chosen, against the drawn canvas.** Cached graphs on
 * the live archive, node count against that day's headlines and its `df >= 3`
 * pool:
 *
 *   headlines   539   691   899  1144  2197+
 *   pool        221   373   530   605   ...
 *   nodes        36    68    70    70    70
 *
 * So the canvas fills somewhere between a pool of 373 and 530 — call it 450 —
 * and on a filling day that arrives at roughly 860 headlines, interpolating the
 * morning's own curve (07:00 is 587 headlines and pool 269; 11:00 is 1,160 and
 * pool 646). Against a typical 3,077-headline day that is **0.28**.
 *
 * **It is a plateau midpoint, not an edge.** Across three days the 07:00 state
 * sits at 0.19 of the day's final total and the 11:00 state at 0.35-0.40, so
 * anything in (0.19, 0.35] separates them and 0.28 is a full 0.09 clear of
 * either side. Same habit as `alpha_min_spread`: do not retune this to the
 * first decimal that looks better on one day.
 *
 * **A share rather than a headline count**, because an absolute number goes
 * stale every time collection changes depth, and it has already changed three
 * times in this archive — six runs a day, `collect_cap` 150 -> 300, and twelve
 * runs a day. A ratio re-bases itself.
 */
export const RIPE_SHARE = 0.28

/**
 * How many older collected days the baseline is taken over.
 *
 * Long enough that one outlier cannot set it — the archive holds a 4,218-day
 * against a typical 3,077 — and short enough that a run of thin days from
 * months ago cannot make a thin today look normal.
 */
export const BASELINE_DAYS = 7

/** Middle value, averaging the two middle ones on an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * The newest collected day that has filled up, or the newest one there is.
 *
 * `dates` is `fetchCollectedDates()`'s answer — newest first, one row per
 * collected day, with that day's headline total. **Nothing here issues a
 * request**: App already reads this view on every load for the surge
 * comparison's denominators.
 *
 * **The oldest day always qualifies**, because there is nothing older to
 * measure it against. That is what keeps a fresh archive openable, and it is
 * why the "nothing qualified" fallback below can never actually fire — it
 * stays as the guarantee that this function returns a date rather than a
 * branch anybody has to handle.
 */
export function pickOpeningDate(
  dates: CollectedDate[],
  today: string,
  share: number = RIPE_SHARE,
): string {
  if (dates.length === 0) return today

  for (let index = 0; index < dates.length; index++) {
    const baseline = dates.slice(index + 1, index + 1 + BASELINE_DAYS)
    if (baseline.length === 0) return dates[index].date
    if (dates[index].headlines >= share * median(baseline.map((d) => d.headlines))) {
      return dates[index].date
    }
  }

  return dates[0].date
}
