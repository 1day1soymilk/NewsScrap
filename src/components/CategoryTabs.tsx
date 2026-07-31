import type { Category } from '../lib/types'

interface CategoryTabsProps {
  categories: Category[]
  selected: string | null
  onSelect: (slug: string | null) => void
}

export function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  return (
    <nav className="flex flex-wrap justify-center gap-2">
      <button
        onClick={() => onSelect(null)}
        className={`rounded-full px-3 py-1 text-sm ${selected === null ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}
      >
        전체
      </button>
      {categories.map((category) => (
        <button
          key={category.slug}
          onClick={() => onSelect(category.slug)}
          className={`rounded-full px-3 py-1 text-sm ${
            selected === category.slug ? 'bg-gray-900 text-white' : 'bg-gray-100'
          }`}
        >
          {category.label}
        </button>
      ))}
    </nav>
  )
}
