// WCAG 2.1 contrast and plain HSL hue, used by theme.test.ts to hold the
// palette to the two rules it was chosen to satisfy. Kept here rather than in
// the test so the arithmetic itself is covered.

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.startsWith('#') ? hex.slice(1) : hex
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`not a six-digit hex colour: ${hex}`)
  }
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function linearise(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

// Degrees around the colour wheel. Null for an achromatic colour: it has no
// hue, so the separation rule does not apply to it and must not be faked.
export function hue(hex: string): number | null {
  const { r, g, b } = hexToRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return null

  let degrees: number
  if (max === r) degrees = 60 * (((g - b) / delta) % 6)
  else if (max === g) degrees = 60 * ((b - r) / delta + 2)
  else degrees = 60 * ((r - g) / delta + 4)

  return (degrees + 360) % 360
}

// The short way round, so 350 and 10 are 20 degrees apart rather than 340.
export function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360
  return raw > 180 ? 360 - raw : raw
}
