import { describe, expect, it } from 'vitest'
import { computeSurges, surgeLimitFor } from './surge'
import type { DaySnapshot } from './surge'

function day(headlines: number, pairs: [string, number][]): DaySnapshot {
  return { headlines, counts: pairs.map(([word, count]) => ({ word, count })) }
}

describe('computeSurges', () => {
  it('marks a word that was absent the previous day as new', () => {
    const surges = computeSurges(
      day(100, [['폭염', 10], ['정부', 10]]),
      day(100, [['정부', 10]]),
    )
    expect(surges.get('폭염')).toMatchObject({ kind: 'new', ratio: null })
  })

  it('marks a word whose share of the day grew as surging, with its ratio', () => {
    const surges = computeSurges(
      day(100, [['폭염', 30]]),
      day(100, [['폭염', 10]]),
    )
    expect(surges.get('폭염')?.kind).toBe('surging')
    expect(surges.get('폭염')?.ratio).toBeCloseTo(3)
  })

  it('leaves a word holding a steady share unmarked', () => {
    const surges = computeSurges(
      day(100, [['정부', 10]]),
      day(100, [['정부', 10]]),
    )
    expect(surges.has('정부')).toBe(false)
  })

  it('leaves a word whose share shrank unmarked', () => {
    const surges = computeSurges(day(200, [['정부', 10]]), day(100, [['정부', 10]]))
    expect(surges.has('정부')).toBe(false)
  })

  // The reason shares are compared rather than counts. 2026-08-01 was collected
  // twice — a manual run plus the 13:00 KST cron, with the 150-per-category cap
  // applying per run — so it holds 1,382 headlines against 2026-07-31's 900.
  // Every count that day is inflated by the same factor, and inflating
  // everything is not news about any word.
  it('is unmoved by a day that was collected twice', () => {
    const yesterday = day(900, [['폭염', 45], ['정부', 20], ['시장', 15]])
    const doubled = day(1800, [['폭염', 90], ['정부', 40], ['시장', 30]])
    expect(computeSurges(doubled, yesterday).size).toBe(0)
  })

  it('reports nothing when there is no previous day', () => {
    expect(computeSurges(day(100, [['폭염', 10]]), day(0, [])).size).toBe(0)
  })

  it('ignores a word too rare for the movement to mean anything', () => {
    const surges = computeSurges(day(100, [['하마평', 2]]), day(100, []))
    expect(surges.has('하마평')).toBe(false)
  })

  // A ratio cut of 1.5 marked 58 of the 110 words drawn on 2026-08-01, and a
  // mark on half the screen points at nothing. Only the biggest movers get one.
  it('marks at most `limit` words', () => {
    const today = day(100, [
      ['가', 10], ['나', 9], ['다', 8], ['라', 7], ['마', 6], ['바', 5],
    ])
    const surges = computeSurges(today, day(100, []), { limit: 3 })

    expect([...surges.keys()]).toEqual(['가', '나', '다'])
  })

  // The point of ranking on gained share rather than on the ratio. 까마귀 is a
  // fluff story that appeared from nothing; 호르무즈 is the day's real event
  // and was already present. The ratio puts the fluff first — infinite beats
  // 5.9x — and the share it actually gained does not.
  it('puts a big word that grew ahead of a small word that appeared', () => {
    const surges = computeSurges(
      day(1382, [['호르무즈', 18], ['까마귀', 10]]),
      day(900, [['호르무즈', 2]]),
      { limit: 1 },
    )
    expect([...surges.keys()]).toEqual(['호르무즈'])
  })

  it('breaks ties on the word so the same day marks the same words', () => {
    const today = day(100, [['나', 5], ['가', 5]])
    const surges = computeSurges(today, day(100, []), { limit: 1 })
    expect([...surges.keys()]).toEqual(['가'])
  })

  // The denominator is supplied rather than summed from `counts`, because
  // `counts` is a response PostgREST can cut at 1,000 rows. Summing it is how
  // this went wrong the first time: it inflated every ratio by 11%.
  it('marks nothing when the word list is empty', () => {
    expect(computeSurges(day(100, []), day(100, [['폭염', 10]])).size).toBe(0)
  })

  it('normalises by the headline total it was given, not by the counts it sees', () => {
    // Same word, same counts, different days behind them.
    const counts: [string, number][] = [['폭염', 10]]
    expect(computeSurges(day(100, counts), day(100, counts)).size).toBe(0)
    expect(computeSurges(day(50, counts), day(100, counts)).get('폭염')?.ratio).toBeCloseTo(2)
  })
})

describe('surgeLimitFor', () => {
  // The all-categories view of 2026-08-01 drew 110 words; a category tab draws
  // a few dozen at most. A flat cap of eight is an annotation on the first and
  // covers most of the second.
  it('marks at most eight words however big the graph is', () => {
    expect(surgeLimitFor(110)).toBe(8)
    expect(surgeLimitFor(500)).toBe(8)
  })

  it('scales down with the graph', () => {
    expect(surgeLimitFor(56)).toBe(4)
    expect(surgeLimitFor(28)).toBe(2)
  })

  it('never gives up marking entirely', () => {
    expect(surgeLimitFor(8)).toBe(1)
    expect(surgeLimitFor(1)).toBe(1)
  })
})
