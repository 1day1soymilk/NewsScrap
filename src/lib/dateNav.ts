export type Direction = 'prev' | 'next'

/**
 * The nearest collected date on one side of `from`, or null if there is none.
 *
 * "Strictly before/after" rather than "one index along" because the app opens
 * on today whether or not today has been collected — the cron runs at 13:00
 * KST, so until then today is not in the list at all — and because the archive
 * has gaps. Stepping by index would land on an empty day or refuse to move.
 *
 * ISO dates compare correctly as strings, so no Date objects are involved and
 * no timezone can shift the answer.
 */
export function adjacentDate(dates: string[], from: string, direction: Direction): string | null {
  let best: string | null = null

  for (const date of dates) {
    if (direction === 'prev') {
      if (date < from && (best === null || date > best)) best = date
    } else {
      if (date > from && (best === null || date < best)) best = date
    }
  }

  return best
}
