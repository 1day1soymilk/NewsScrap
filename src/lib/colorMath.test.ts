import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToRgb, hue, hueDistance, relativeLuminance } from './colorMath'

describe('hexToRgb', () => {
  it('parses a six-digit hex', () => {
    expect(hexToRgb('#4338ca')).toEqual({ r: 0x43, g: 0x38, b: 0xca })
  })

  // A silently-wrong colour is worse than a crash here: every rule in
  // theme.test.ts is computed from these numbers.
  it('rejects anything that is not a six-digit hex', () => {
    expect(() => hexToRgb('#abc')).toThrow()
    expect(() => hexToRgb('rebeccapurple')).toThrow()
  })
})

describe('relativeLuminance', () => {
  it('runs from 0 at black to 1 at white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('contrastRatio', () => {
  it('gives WCAG 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
  })

  it('gives 1:1 for a colour against itself', () => {
    expect(contrastRatio('#15803d', '#15803d')).toBeCloseTo(1, 5)
  })

  it('does not care which argument is lighter', () => {
    expect(contrastRatio('#0f172a', '#f8fafc')).toBeCloseTo(
      contrastRatio('#f8fafc', '#0f172a'),
      10,
    )
  })
})

describe('hue', () => {
  it('places the primaries at 0, 120 and 240 degrees', () => {
    expect(hue('#ff0000')).toBeCloseTo(0, 4)
    expect(hue('#00ff00')).toBeCloseTo(120, 4)
    expect(hue('#0000ff')).toBeCloseTo(240, 4)
  })

  // Grey has no hue, and the spacing rule cannot be applied to it. Returning 0
  // would put it next to red and quietly pass a rule it was never subject to.
  it('returns null for a colour with no chroma', () => {
    expect(hue('#64748b')).not.toBeNull()
    expect(hue('#808080')).toBeNull()
  })
})

describe('hueDistance', () => {
  it('measures the short way around the wheel', () => {
    expect(hueDistance(350, 10)).toBeCloseTo(20, 5)
    expect(hueDistance(10, 350)).toBeCloseTo(20, 5)
  })

  it('caps at half a turn', () => {
    expect(hueDistance(0, 180)).toBeCloseTo(180, 5)
  })
})
