import { describe, expect, it } from 'vitest'
import { computeFontSizes } from './wordCloudLayout'

describe('computeFontSizes', () => {
  it('maps the highest count to the max font size and the lowest to the min', () => {
    const result = computeFontSizes([
      { word: '여야', count: 1 },
      { word: '예산안', count: 10 },
    ])

    const bySizeDesc = [...result].sort((a, b) => b.fontSize - a.fontSize)
    expect(bySizeDesc[0].text).toBe('예산안')
    expect(bySizeDesc[0].fontSize).toBe(64)
    expect(bySizeDesc[1].text).toBe('여야')
    expect(bySizeDesc[1].fontSize).toBe(14)
  })

  it('gives every word the max font size when all counts are equal', () => {
    const result = computeFontSizes([
      { word: 'a', count: 5 },
      { word: 'b', count: 5 },
    ])
    expect(result.every((w) => w.fontSize === 64)).toBe(true)
  })

  it('returns an empty array for empty input', () => {
    expect(computeFontSizes([])).toEqual([])
  })
})
