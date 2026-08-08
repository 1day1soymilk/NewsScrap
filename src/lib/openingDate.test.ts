import { describe, expect, it } from 'vitest'
import { BASELINE_DAYS, RIPE_SHARE, pickOpeningDate } from './openingDate'
import type { CollectedDate } from './queries'

/** Newest first, the order `fetchCollectedDates` returns. */
function days(...pairs: [string, number][]): CollectedDate[] {
  return pairs.map(([date, headlines]) => ({ date, headlines }))
}

const FULL = days(
  ['2026-08-08', 3100],
  ['2026-08-07', 3317],
  ['2026-08-06', 3077],
  ['2026-08-05', 3077],
)

describe('pickOpeningDate', () => {
  it('opens on today when today has filled up', () => {
    expect(pickOpeningDate(FULL, '2026-08-08')).toBe('2026-08-08')
  })

  it('falls back to the previous day when today is still thin', () => {
    // The 07:00 state of a real day: 587 headlines against a ~3,100 baseline,
    // which draws roughly 50 of the canvas's 70 words.
    const dates = days(
      ['2026-08-08', 587],
      ['2026-08-07', 3317],
      ['2026-08-06', 3077],
      ['2026-08-05', 3077],
    )
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-07')
  })

  it('opens on the newest collected day when today has not been collected at all', () => {
    // Before the day's first cron, today is not in the view at all.
    const dates = days(['2026-08-07', 3317], ['2026-08-06', 3077], ['2026-08-05', 3077])
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-07')
  })

  it('skips more than one thin day rather than stopping at the first', () => {
    // A collection that failed yesterday too. Neither is worth opening on, and
    // a rule that only ever looked one day back would land on the second one.
    const dates = days(
      ['2026-08-08', 200],
      ['2026-08-07', 300],
      ['2026-08-06', 3077],
      ['2026-08-05', 3077],
    )
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-06')
  })

  it("opens on the archive's first day, which has nothing to be compared against", () => {
    // The rule degrades to "open on the newest" when there is no baseline.
    // Otherwise a fresh archive could never open on anything at all.
    const dates = days(['2026-07-31', 12])
    expect(pickOpeningDate(dates, '2026-07-31')).toBe('2026-07-31')
  })

  it('returns today when nothing has ever been collected', () => {
    expect(pickOpeningDate([], '2026-08-08')).toBe('2026-08-08')
  })

  it('always answers with a date that exists, whatever the counts', () => {
    // The shape guarantee, not an arithmetic one: nothing downstream has a
    // branch for "no date", so this function may not have one either.
    const shapes = [
      days(['2026-08-08', 0]),
      days(['2026-08-08', 0], ['2026-08-07', 0]),
      days(['2026-08-08', 1], ['2026-08-07', 10], ['2026-08-06', 100]),
      days(['2026-08-08', 100], ['2026-08-07', 10], ['2026-08-06', 1]),
    ]
    for (const dates of shapes) {
      const picked = pickOpeningDate(dates, '2026-08-08')
      expect(dates.map((d) => d.date)).toContain(picked)
    }
  })

  it('leaves the e2e fixture opening on today', () => {
    // e2e/support/fixtures.ts is today 12 / yesterday 8. If the rule moved this
    // one, fifty Playwright tests would change meaning without being edited.
    const dates = days(['2026-08-08', 12], ['2026-08-07', 8])
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-08')
  })

  it('takes the median rather than the mean, so one fat day cannot raise the bar', () => {
    // The archive really does hold an outlier — 2026-08-04 at 4,218 against a
    // typical 3,077 — and a mean baseline lets one such day reject ordinary
    // ones. Here the mean of the four older days is 7,367 and the median 3,197.
    const dates = days(
      ['2026-08-08', 1300],
      ['2026-08-07', 3317],
      ['2026-08-06', 3077],
      ['2026-08-05', 3077],
      ['2026-08-04', 20000],
    )
    expect(RIPE_SHARE * 3197).toBeLessThanOrEqual(1300)
    expect(RIPE_SHARE * 7367).toBeGreaterThan(1300)
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-08')
  })

  it('looks no further back than the baseline window', () => {
    // Seven ordinary days and then a long tail of near-empty ones. Unwindowed,
    // the tail would drag the median down to 1 and call today ripe.
    const dates = days(
      ['2026-08-08', 500],
      ...Array.from(
        { length: BASELINE_DAYS },
        (_, i) => [`2026-08-0${BASELINE_DAYS - i}`, 3000] as [string, number],
      ),
      ...Array.from({ length: 8 }, (_, i) => [`2026-07-2${i}`, 1] as [string, number]),
    )
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-07')
  })

  it('honours an explicit share', () => {
    const dates = days(['2026-08-08', 587], ['2026-08-07', 3000], ['2026-08-06', 3000])
    expect(pickOpeningDate(dates, '2026-08-08', 0.1)).toBe('2026-08-08')
    expect(pickOpeningDate(dates, '2026-08-08', 0.9)).toBe('2026-08-07')
  })

  it('ships a share that rejects the 07:00 state and accepts the 11:00 one', () => {
    // The measurement the constant comes from, pinned here so a retune has to
    // move this line and say why. Against a ~3,100 baseline, 2026-08-07 held
    // 587 headlines at 07:00 (pool 269, about 50 of 70 words drawn) and 1,160
    // at 11:00 (pool 646, a full canvas).
    expect(587).toBeLessThan(RIPE_SHARE * 3100)
    expect(1160).toBeGreaterThanOrEqual(RIPE_SHARE * 3100)
  })
})
