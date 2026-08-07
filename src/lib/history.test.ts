import { describe, expect, it } from 'vitest'
import { HISTORY_WINDOW, buildHistory, historyWindow, summariseHistory } from './history'
import type { WordCount } from './types'

// Newest first, which is the order fetchCollectedDates returns.
const DATES = ['2026-08-05', '2026-08-04', '2026-08-03']

function counts(rows: Record<string, number>): Map<string, WordCount[]> {
  return new Map(
    Object.entries(rows).map(([date, count]) => [date, [{ word: '폭염', count }]]),
  )
}

const HEADLINES = new Map([
  ['2026-08-05', 100],
  ['2026-08-04', 200],
  ['2026-08-03', 50],
])

describe('buildHistory', () => {
  it('reads oldest first, so the series runs left to right', () => {
    const points = buildHistory(
      counts({ '2026-08-03': 5, '2026-08-04': 20, '2026-08-05': 10 }),
      HEADLINES,
      DATES,
      { endDate: '2026-08-05' },
    )
    expect(points.map((point) => point.date)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ])
  })

  // The whole reason the y axis is share: 08-04 holds four times the count of
  // 08-03 and a smaller share of its day.
  it('divides each day by its own headline total', () => {
    const points = buildHistory(
      counts({ '2026-08-03': 5, '2026-08-04': 20, '2026-08-05': 10 }),
      HEADLINES,
      DATES,
      { endDate: '2026-08-05' },
    )
    expect(points.map((point) => point.share)).toEqual([0.1, 0.1, 0.1])
  })

  it('stops at the selected date rather than at the newest one', () => {
    const points = buildHistory(
      counts({ '2026-08-03': 5, '2026-08-04': 20, '2026-08-05': 10 }),
      HEADLINES,
      DATES,
      { endDate: '2026-08-04' },
    )
    expect(points.map((point) => point.date)).toEqual(['2026-08-03', '2026-08-04'])
  })

  // A gap would read as "not collected". A day that was collected and simply
  // did not hold the word is a zero, and says so.
  it('draws a day the word is absent from as zero, not as a hole', () => {
    const points = buildHistory(counts({ '2026-08-05': 10 }), HEADLINES, DATES, {
      endDate: '2026-08-05',
    })
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ date: '2026-08-03', count: 0, share: 0, present: false })
    expect(points[2].present).toBe(true)
  })

  it('keeps only the last `window` collected days', () => {
    const many = Array.from({ length: 20 }, (_, i) => `2026-07-${String(20 - i).padStart(2, '0')}`)
    const points = buildHistory(new Map(), new Map(), many, {
      endDate: '2026-07-20',
      window: 3,
    })
    expect(points.map((point) => point.date)).toEqual(['2026-07-18', '2026-07-19', '2026-07-20'])
  })

  it('defaults the window to HISTORY_WINDOW', () => {
    const many = Array.from({ length: 30 }, (_, i) => `2026-07-${String(30 - i).padStart(2, '0')}`)
    const points = buildHistory(new Map(), new Map(), many, { endDate: '2026-07-30' })
    expect(points).toHaveLength(HISTORY_WINDOW)
  })

  // collected_dates and the counts come from the same source, so this should
  // not happen — but a missing denominator must not become NaN on a chart.
  it('is zero for a day with no denominator', () => {
    const points = buildHistory(counts({ '2026-08-03': 5 }), new Map(), DATES, {
      endDate: '2026-08-03',
    })
    expect(points[0]).toEqual({ date: '2026-08-03', count: 5, share: 0, present: true })
  })

  it('is empty when the selected date is older than everything collected', () => {
    expect(buildHistory(new Map(), HEADLINES, DATES, { endDate: '2026-07-01' })).toEqual([])
  })
})

describe('historyWindow', () => {
  it('keeps only dates on or before endDate, sorted', () => {
    expect(historyWindow(['2026-08-05', '2026-08-03', '2026-08-04'], '2026-08-04')).toEqual([
      '2026-08-03',
      '2026-08-04',
    ])
  })

  it('keeps only the last `window` collected days', () => {
    const many = Array.from({ length: 20 }, (_, i) => `2026-07-${String(20 - i).padStart(2, '0')}`)
    expect(historyWindow(many, '2026-07-20', 3)).toEqual(['2026-07-18', '2026-07-19', '2026-07-20'])
  })

  it('defaults the window to HISTORY_WINDOW', () => {
    const many = Array.from({ length: 30 }, (_, i) => `2026-07-${String(30 - i).padStart(2, '0')}`)
    expect(historyWindow(many, '2026-07-30')).toHaveLength(HISTORY_WINDOW)
  })

  it('is empty when endDate is older than everything collected', () => {
    expect(historyWindow(['2026-08-01', '2026-08-02'], '2026-07-01')).toEqual([])
  })

  // The whole reason this function is exported rather than staying inline
  // inside buildHistory: a caller that bounds a fetch by it and a caller that
  // builds a series by it must be describing the same days, or a request can
  // ask for a wider set of dates than the series ever draws.
  it('agrees with what buildHistory keeps, given the same inputs', () => {
    const many = Array.from({ length: 40 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`)
    const windowed = historyWindow(many, '2026-06-25')
    const points = buildHistory(new Map(), new Map(), many, { endDate: '2026-06-25' })
    expect(points.map((point) => point.date)).toEqual(windowed)
  })
})

describe('summariseHistory', () => {
  const points = (shares: number[]) =>
    shares.map((value, index) => ({
      date: `2026-08-0${index + 1}`,
      count: value === 0 ? 0 : 1,
      share: value,
      present: value > 0,
    }))

  it('counts the days it appeared on out of the days in the window', () => {
    expect(summariseHistory(points([0, 0.1, 0.2]))).toMatchObject({
      days: 3,
      daysPresent: 2,
    })
  })

  it('reports the last step as a proportion of the step before it', () => {
    expect(summariseHistory(points([0.1, 0.2])).change).toBeCloseTo(1)
  })

  // A word absent yesterday has not risen by a percentage. It is new, and the
  // caption says that word instead of a number.
  it('has no change and is new when it was absent the day before', () => {
    expect(summariseHistory(points([0, 0.2]))).toMatchObject({ change: null, isNew: true })
  })

  it('is not new when it appeared earlier in the window', () => {
    expect(summariseHistory(points([0.3, 0, 0.2]))).toMatchObject({ isNew: false })
  })

  it('has no change on a one-day window', () => {
    expect(summariseHistory(points([0.2])).change).toBeNull()
  })

  it('survives an empty series', () => {
    expect(summariseHistory([])).toEqual({ days: 0, daysPresent: 0, change: null, isNew: false })
  })
})
