import { describe, expect, it } from 'vitest'
// Vite hands back the file's source text. tsconfig.app.json has no "node" in
// its types, so node:fs is not available here, and adding it would let any
// browser module import a node builtin.
import cssSource from '../index.css?raw'
import { contrastRatio, hue, hueDistance } from './colorMath'

// src/index.css is the only place these values live. Reading them back is what
// stops a later edit from quietly breaking the rules the palette was picked to
// satisfy — the alternative is a comment, and comments do not fail a build.
function token(name: string): string {
  const match = cssSource.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`--${name} is not defined in src/index.css`)
  return match[1]
}

const SECTIONS = ['politics', 'economy', 'society', 'culture', 'world', 'it'] as const
const MIN_HUE_SEPARATION = 40
const MIN_CONTRAST = 4.5

function sectionHue(slug: string): number {
  const degrees = hue(token(`color-section-${slug}`))
  if (degrees === null) throw new Error(`--color-section-${slug} has no hue`)
  return degrees
}

describe('section palette', () => {
  it('clears 4.5:1 against the ground', () => {
    // 4.5 rather than the 3:1 allowed for large text: MIN_FONT_SIZE is 14, so
    // the smallest label on the graph is small text.
    const ground = token('color-ground')
    for (const slug of SECTIONS) {
      expect(contrastRatio(token(`color-section-${slug}`), ground)).toBeGreaterThanOrEqual(
        MIN_CONTRAST,
      )
    }
  })

  // The rule this whole task exists for. The palette it replaces had economy,
  // world, society and IT inside one 80-degree band, two of them 22 degrees
  // apart, so four of the six sections were not tellable apart by colour.
  it('keeps every pair of sections at least 40 degrees apart', () => {
    for (let i = 0; i < SECTIONS.length; i += 1) {
      for (let j = i + 1; j < SECTIONS.length; j += 1) {
        const separation = hueDistance(sectionHue(SECTIONS[i]), sectionHue(SECTIONS[j]))
        expect(
          separation,
          `${SECTIONS[i]} and ${SECTIONS[j]} are ${separation.toFixed(1)} degrees apart`,
        ).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION)
      }
    }
  })
})

describe('surge colour', () => {
  // The marker is drawn touching its word. Sharing a hue band with any section
  // would make it read as part of the label rather than as a claim about it.
  it('is reserved from every section hue', () => {
    const surge = hue(token('color-surge'))
    expect(surge).not.toBeNull()
    for (const slug of SECTIONS) {
      expect(hueDistance(surge!, sectionHue(slug))).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION)
    }
  })

  it('clears 4.5:1 against the ground', () => {
    expect(contrastRatio(token('color-surge'), token('color-ground'))).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    )
  })
})

describe('ink scale', () => {
  it('is readable at all three levels', () => {
    const ground = token('color-ground')
    for (const name of ['color-ink', 'color-ink-muted', 'color-ink-faint']) {
      expect(contrastRatio(token(name), ground), name).toBeGreaterThanOrEqual(MIN_CONTRAST)
    }
  })
})

describe('cluster shading', () => {
  // Two overlapping washes double their opacity, which is how the old palette
  // let a pair of ordinary clusters land on the top story's strength. Neutral
  // grey cannot stack into blue, so the failure mode goes away structurally
  // rather than by tuning a number.
  it('separates the top story from ordinary clusters by hue, not by opacity', () => {
    expect(hue(token('color-cluster'))).toBeNull()
    expect(hue(token('color-top-story'))).not.toBeNull()
  })
})
