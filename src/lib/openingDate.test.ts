import { describe, expect, it } from 'vitest'
import { pickOpeningDate } from './openingDate'
import type { CollectedDate } from './queries'

/** Newest first, the order `fetchCollectedDates` returns. */
function days(...pairs: [string, number][]): CollectedDate[] {
  return pairs.map(([date, headlines]) => ({ date, headlines }))
}

describe('pickOpeningDate', () => {
  it('opens on today once today has been collected', () => {
    const dates = days(['2026-08-08', 3100], ['2026-08-07', 3317], ['2026-08-06', 3077])
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-08')
  })

  it('opens on today even while today is still thin', () => {
    // **The case that retired the old rule.** 2026-08-08 at 15:07 KST held 808
    // headlines against a ~3,100 baseline and drew 66 of the canvas's 70 words,
    // and the share rule opened on the day before because 808 is under 862.
    const dates = days(['2026-08-08', 808], ['2026-08-07', 3317], ['2026-08-06', 3077])
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-08')
  })

  it('opens on today at the first cron, on the thinnest day the archive has seen', () => {
    // 03:00 KST is 198-237 headlines. Thin is not empty, and the reader asked
    // for today.
    const dates = days(['2026-08-08', 198], ['2026-08-07', 3317])
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-08')
  })

  it('opens on the newest collected day when today has not been collected at all', () => {
    // Between midnight and the day's first cron today is not in the view, so
    // there is genuinely nothing to draw. This is the whole of the fallback.
    const dates = days(['2026-08-07', 3317], ['2026-08-06', 3077], ['2026-08-05', 3077])
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-07')
  })

  it('does not skip a thin yesterday when today is missing', () => {
    // The old rule walked back over any day it judged unripe and could land two
    // or three days back. A collection that failed yesterday is still the newest
    // thing there is, and burying it is not this rule's business.
    const dates = days(['2026-08-07', 300], ['2026-08-06', 3077])
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-07')
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

  it('ignores the headline counts entirely', () => {
    // The old rule's input is now not read, and that is the change rather than a
    // detail of it. Same days, wildly different counts, same answer.
    const thin = days(['2026-08-08', 1], ['2026-08-07', 9999])
    const fat = days(['2026-08-08', 9999], ['2026-08-07', 1])
    expect(pickOpeningDate(thin, '2026-08-08')).toBe(pickOpeningDate(fat, '2026-08-08'))
  })

  it('leaves the e2e fixture opening on today', () => {
    // e2e/support/fixtures.ts is today 12 / yesterday 8. If the rule moved this
    // one, fifty Playwright tests would change meaning without being edited.
    const dates = days(['2026-08-08', 12], ['2026-08-07', 8])
    expect(pickOpeningDate(dates, '2026-08-08')).toBe('2026-08-08')
  })
})
