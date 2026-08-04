import { describe, expect, it } from 'vitest'
import { DEFAULT_COLLECT_CAP, resolveCollectCap } from './collectCap'

describe('resolveCollectCap', () => {
  it('takes the number the row carries', () => {
    expect(resolveCollectCap(300)).toBe(300)
  })

  // PostgREST returns `numeric` as a string on some paths.
  it('takes a numeric string', () => {
    expect(resolveCollectCap('300')).toBe(300)
  })

  // Every one of these is a read that failed in some way, and every one of them
  // would become a cap of 0 under `Number(value ?? 150)` — a run that scrapes
  // nothing and reports six successes.
  it.each([
    ['a missing row', undefined],
    ['a null value', null],
    ['an unparseable value', 'many'],
    ['an object', {}],
    ['zero', 0],
    ['a negative number', -1],
  ])('falls back to the default on %s', (_label, value) => {
    expect(resolveCollectCap(value)).toBe(DEFAULT_COLLECT_CAP)
  })

  // scoring_weights.value is numeric, so a fractional cap is storable. Slicing
  // an array by 150.7 is not an error, it is just a cap nobody chose.
  it('floors a fractional cap', () => {
    expect(resolveCollectCap('150.7')).toBe(150)
  })
})
