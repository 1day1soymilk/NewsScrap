import type { Category } from '../lib/types'

interface CategoryTabsProps {
  categories: Category[]
  selected: string | null
  onSelect: (slug: string | null) => void
}

export function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  // aria-pressed as well as the fill: which tab is on is now part of the
  // state a link restores, and colour alone does not say so to a screen
  // reader or to a test.
  const className = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm transition-colors ${
      active
        ? 'bg-ink text-surface'
        : 'bg-surface text-ink-muted ring-1 ring-line hover:text-ink'
    }`

  return (
    <nav className="flex flex-wrap justify-center gap-2 sm:justify-end">
      <button onClick={() => onSelect(null)} aria-pressed={selected === null} className={className(selected === null)}>
        전체
      </button>
      {categories.map((category) => (
        <button
          key={category.slug}
          onClick={() => onSelect(category.slug)}
          aria-pressed={selected === category.slug}
          className={className(selected === category.slug)}
        >
          {category.label}
        </button>
      ))}
    </nav>
  )
}
