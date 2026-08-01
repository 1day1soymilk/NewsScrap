import type { Category } from '../lib/types'
import { ALL_SECTIONS_SWATCH, sectionColor } from '../lib/sectionColors'

interface CategoryTabsProps {
  categories: Category[]
  selected: string | null
  onSelect: (slug: string | null) => void
}

// The tab row is also the graph's colour key. Nothing else on the page said what
// the six inks meant, so there was no way to learn that 코스피 is green because
// it is an 경제 word — the encoding the canvas leans on hardest was the one with
// no legend. Putting the swatch on the control that filters by the same thing
// keeps the key on screen without a second block competing with the graph.
export function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  // aria-pressed as well as the underline: which tab is on is part of the state
  // a link restores, and neither colour nor weight says so to a screen reader.
  const className = (active: boolean) =>
    `group flex items-center gap-1.5 border-b-2 px-1 pb-1 text-sm transition-colors ${
      active ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-faint hover:text-ink'
    }`

  const dot = (background: string, active: boolean) => (
    <span
      aria-hidden="true"
      className={`size-2.5 shrink-0 rounded-full transition-opacity ${
        active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'
      }`}
      style={{ background }}
    />
  )

  return (
    <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 sm:justify-end">
      <button
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={className(selected === null)}
      >
        {dot(ALL_SECTIONS_SWATCH, selected === null)}
        전체
      </button>
      {categories.map((category) => (
        <button
          key={category.slug}
          onClick={() => onSelect(category.slug)}
          aria-pressed={selected === category.slug}
          className={className(selected === category.slug)}
        >
          {dot(sectionColor(category.slug), selected === category.slug)}
          {category.label}
        </button>
      ))}
    </nav>
  )
}
