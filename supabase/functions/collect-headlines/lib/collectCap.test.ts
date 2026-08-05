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

  // Every one of these is a read that failed in some way, but not in the same
  // way. Only `null` is the case that `Number(value ?? 150)` would silently turn
  // into a cap of 0 — a run that scrapes nothing and reports six successes. The
  // rest fail differently under that one-liner: `undefined` would actually reach
  // 150 correctly (`??` catches it), `'many'` and `{}` become `NaN`, and `-1`
  // stays a negative cap. NaN, a negative cap and a zero cap are each just as
  // unusable as the one the brief's one-liner was written against — which is why
  // the resolver below covers shapes rather than guarding the single value that
  // motivated it.
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
