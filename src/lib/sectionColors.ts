// The six section inks, as references into the @theme block in src/index.css.
//
// Shared because the graph and the tab row have to agree: the tabs are the
// canvas's colour key, and a key that names a different green from the one on
// screen is worse than no key. Holding the values as var() strings rather than
// hex is what keeps src/lib/theme.test.ts the only place a colour is decided.
export const SECTION_COLORS: Record<string, string> = {
  politics: 'var(--color-section-politics)',
  economy: 'var(--color-section-economy)',
  society: 'var(--color-section-society)',
  culture: 'var(--color-section-culture)',
  world: 'var(--color-section-world)',
  it: 'var(--color-section-it)',
}

export const NEUTRAL_INK = 'var(--color-ink)'

export function sectionColor(slug: string | undefined): string {
  if (!slug) return NEUTRAL_INK
  return SECTION_COLORS[slug] ?? NEUTRAL_INK
}

// The all-sections swatch: the palette itself, as one dot. Ordered the way the
// tabs are, so the wedge under each tab's own dot is the colour that tab means.
export const ALL_SECTIONS_SWATCH = `conic-gradient(${Object.values(SECTION_COLORS)
  .map((color, index, all) => `${color} ${(index * 100) / all.length}% ${((index + 1) * 100) / all.length}%`)
  .join(', ')})`
