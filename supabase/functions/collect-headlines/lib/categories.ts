export interface Category {
  slug: string
  label: string
  sectionId: string
}

export const CATEGORIES: Category[] = [
  { slug: 'politics', label: '정치', sectionId: '100' },
  { slug: 'economy', label: '경제', sectionId: '101' },
  { slug: 'society', label: '사회', sectionId: '102' },
  { slug: 'culture', label: '생활/문화', sectionId: '103' },
  { slug: 'world', label: '세계', sectionId: '104' },
  { slug: 'it', label: 'IT/과학', sectionId: '105' },
]
