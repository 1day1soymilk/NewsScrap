import { describe, expect, it } from 'vitest'
import { adjacentDate } from './dateNav'

// fetchAvailableDates() returns newest first; these are in that order on
// purpose, so a change to that ordering breaks here rather than in the UI.
const DATES = ['2026-08-01', '2026-07-31', '2026-07-28']

describe('adjacentDate', () => {
  it('steps back to the previous collected date', () => {
    expect(adjacentDate(DATES, '2026-08-01', 'prev')).toBe('2026-07-31')
  })

  it('steps forward to the next collected date', () => {
    expect(adjacentDate(DATES, '2026-07-31', 'next')).toBe('2026-08-01')
  })

  // 7/29 and 7/30 were never collected, so stepping back from 7/31 skips them
  // rather than landing on an empty day.
  it('skips over gaps in the archive', () => {
    expect(adjacentDate(DATES, '2026-07-31', 'prev')).toBe('2026-07-28')
  })

  it('returns null at the oldest date', () => {
    expect(adjacentDate(DATES, '2026-07-28', 'prev')).toBeNull()
  })

  it('returns null at the newest date', () => {
    expect(adjacentDate(DATES, '2026-08-01', 'next')).toBeNull()
  })

  // The day on screen can be one that was never collected. With no `?date=` the
  // app now opens on the newest day that has filled up (src/lib/openingDate.ts),
  // but a `?date=` link always wins and may name any day at all, and with nothing
  // collected yet the rule falls back to today.
  it('finds the neighbours of a date that was never collected', () => {
    expect(adjacentDate(DATES, '2026-07-30', 'prev')).toBe('2026-07-28')
    expect(adjacentDate(DATES, '2026-07-30', 'next')).toBe('2026-07-31')
  })

  it('has no neighbours when nothing has been collected', () => {
    expect(adjacentDate([], '2026-08-01', 'prev')).toBeNull()
    expect(adjacentDate([], '2026-08-01', 'next')).toBeNull()
  })

  it('does not depend on the input being sorted', () => {
    const shuffled = ['2026-07-28', '2026-08-01', '2026-07-31']
    expect(adjacentDate(shuffled, '2026-08-01', 'prev')).toBe('2026-07-31')
    expect(adjacentDate(shuffled, '2026-07-28', 'next')).toBe('2026-07-31')
  })
})
