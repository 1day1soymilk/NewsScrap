import { describe, expect, it } from 'vitest'
import { share } from './share'

describe('share', () => {
  it('divides a count by the day it belongs to', () => {
    expect(share(5, 12)).toBe(5 / 12)
  })

  it('is zero for a word with no headlines that day', () => {
    expect(share(0, 8)).toBe(0)
  })

  // A day with no headlines is a day nothing can be a share of. NaN would
  // poison a sort silently and Infinity would draw a sparkline off the top, so
  // neither may escape this function.
  it('is zero rather than NaN when the day is empty', () => {
    expect(share(3, 0)).toBe(0)
  })

  it('is zero rather than negative when the denominator is nonsense', () => {
    expect(share(3, -5)).toBe(0)
  })
})
