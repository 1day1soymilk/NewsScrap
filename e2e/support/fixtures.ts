export type CategoryRow = { id: string; slug: string; label: string }
export type WordCountRow = { word: string; count: number }
export type CollectedDateRow = { collected_date: string }
export type HeadlineNounRow = {
  word: string
  headlines: {
    id: string
    title: string
    link: string
    collected_date: string
    categories: { slug: string }
  }
}

// Mirrors todayInSeoul() in src/App.tsx so the date input's min/max line up
// with the date the app asks for on load.
export function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

// Order matches fetchCategories()'s `.order('section_id')`.
export const CATEGORIES: CategoryRow[] = [
  { id: '00000000-0000-4000-8000-000000000100', slug: 'politics', label: '정치' },
  { id: '00000000-0000-4000-8000-000000000101', slug: 'economy', label: '경제' },
  { id: '00000000-0000-4000-8000-000000000102', slug: 'society', label: '사회' },
  { id: '00000000-0000-4000-8000-000000000103', slug: 'culture', label: '생활/문화' },
  { id: '00000000-0000-4000-8000-000000000104', slug: 'world', label: '세계' },
  { id: '00000000-0000-4000-8000-000000000105', slug: 'it', label: 'IT/과학' },
]

export const COLLECTED_DATES: CollectedDateRow[] = [{ collected_date: todayInSeoul() }]

// Three short words only: d3-cloud drops whatever does not fit the canvas, and
// short strings at 700x450 are certain to be placed.
export const DEFAULT_WORD_COUNTS: WordCountRow[] = [
  { word: '예산안', count: 5 },
  { word: '여야', count: 3 },
  { word: '국회', count: 1 },
]

export const ECONOMY_WORD_COUNTS: WordCountRow[] = [
  { word: '금리', count: 4 },
  { word: '환율', count: 2 },
]

// Shape matches the nested select in fetchHeadlinesForWord().
export const HEADLINE_ROWS: HeadlineNounRow[] = [
  {
    word: '예산안',
    headlines: {
      id: '00000000-0000-4000-8000-00000000aaa1',
      title: '여야 예산안 처리 합의',
      link: 'https://n.news.naver.com/mnews/article/001/0000000001',
      collected_date: todayInSeoul(),
      categories: { slug: 'politics' },
    },
  },
]
