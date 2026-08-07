// src/lib/history.ts
//
// A word's trajectory across the collected days.
//
// Everything else in this app terminates inside one `collected_date`. This is
// the one axis that crosses days, and it only became legitimate when the
// day-boundary stop shipped: before it, 8.4% of a day's rows carried the wrong
// date, so a line across days would have drawn the collector rather than the
// news.
//
// **Share, never raw counts** — the rule `surge.ts` established by measurement
// and this extends. Days run 691 to 4,218 headlines, and 2026-08-07 is a
// collect-cap regime boundary (150 to 300) on top of that, so a count series
// draws collection depth. Dividing by each day's own total is exactly what a
// step change in depth needs.
//
// **Day-wide, whatever tab is on screen.** Which section is selected decides
// what is *shown*, never what a word *did* that day. Same rule as the surge
// comparison and the sieve.
//
// The counts arrive from `fetchWordCountsFor`, which names its words and so
// cannot be truncated by PostgREST's 1,000-row cap; the denominators arrive
// from `collected_dates`, where they are `count(*)` grouped by day. Neither is
// a summed response — the failure this repository has already paid for once.

import { share } from './share'
import type { WordCount } from './types'

/**
 * How many collected days a trajectory may hold.
 *
 * The archive is 8 days long today, so nothing is dropped yet. The cap is here
 * so the sparkline stays readable in a 320px panel as the archive grows —
 * beyond a couple of weeks the points stop being distinguishable and the line
 * says less, not more.
 */
export const HISTORY_WINDOW = 14

export interface HistoryPoint {
  date: string
  /** Headlines that day holding the word, all six sections. */
  count: number
  /** `count` over that day's headline total. */
  share: number
  /**
   * Was the word in that day's headlines at all? A zero share can mean "absent"
   * or "present but the day was empty", and the sparkline's caption tells them
   * apart.
   */
  present: boolean
}

export interface HistoryOptions {
  /** The day on screen. The series ends here rather than at the newest day. */
  endDate: string
  /** At most this many collected days, counting back from `endDate`. */
  window?: number
}

/**
 * @param countsByDate exactly what `fetchWordCountsFor` returns — date to the
 *   rows for that date. Asked about one word, each entry holds zero rows or
 *   one, and a date missing from the map is a day the word did not appear on.
 * @param headlinesByDate `collected_dates`, date to that day's headline total.
 * @param dates every collected day, newest first, as `fetchCollectedDates`
 *   returns them.
 */
export function buildHistory(
  countsByDate: Map<string, WordCount[]>,
  headlinesByDate: Map<string, number>,
  dates: string[],
  options: HistoryOptions,
): HistoryPoint[] {
  const { endDate, window = HISTORY_WINDOW } = options

  // ISO dates compare correctly as strings, which is why no Date is built here:
  // a Date would drag in a time zone, and every date in this app is already a
  // KST calendar day decided server side.
  const inWindow = dates
    .filter((date) => date <= endDate)
    .sort()
    .slice(-window)

  return inWindow.map((date) => {
    const rows = countsByDate.get(date) ?? []
    const count = rows[0]?.count ?? 0
    return {
      date,
      count,
      share: share(count, headlinesByDate.get(date) ?? 0),
      present: rows.length > 0,
    }
  })
}

export interface HistorySummary {
  /** Collected days in the window. */
  days: number
  /** How many of them the word appeared on. */
  daysPresent: number
  /**
   * The last day's share over the day before it, minus one — so 0.12 is "up
   * 12%". Null when there is no day before, or when the word was absent then:
   * a word that was not there yesterday has not risen by a percentage.
   */
  change: number | null
  /** Present on the last day and on none before it. */
  isNew: boolean
}

export function summariseHistory(points: HistoryPoint[]): HistorySummary {
  const days = points.length
  const daysPresent = points.filter((point) => point.present).length
  if (days === 0) return { days: 0, daysPresent: 0, change: null, isNew: false }

  const last = points[days - 1]
  const before = days > 1 ? points[days - 2] : null
  const isNew = last.present && points.slice(0, -1).every((point) => !point.present)

  return {
    days,
    daysPresent,
    change: before && before.share > 0 ? last.share / before.share - 1 : null,
    isNew,
  }
}
