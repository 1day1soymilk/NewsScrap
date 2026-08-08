export type Direction = 'prev' | 'next'

/**
 * Today, in the timezone the archive is keyed by.
 *
 * 'sv-SE' is not a locale choice — it is the shortest way to get ISO
 * `YYYY-MM-DD` out of `toLocaleDateString`, which is the form every date in
 * this app is compared and stored as.
 *
 * Lives here rather than in App.tsx because main.tsx needs it too: the first
 * graph request is started before React mounts.
 */
export function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

/**
 * The nearest collected date on one side of `from`, or null if there is none.
 *
 * "Strictly before/after" rather than "one index along" because `from` need not
 * be in `dates` at all — a `?date=` link can name any day, and the reader can
 * step to today from the "오늘은 아직 …" line before today has been collected —
 * and because the archive has gaps. Stepping by index would land on an empty
 * day or refuse to move.
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
