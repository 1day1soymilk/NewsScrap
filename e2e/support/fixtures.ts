export type CategoryRow = { id: string; slug: string; label: string }
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

/** The day before that, which is the archive's other collected date here. */
export function previousDayInSeoul(): string {
  const today = new Date(`${todayInSeoul()}T00:00:00Z`)
  today.setUTCDate(today.getUTCDate() - 1)
  return today.toISOString().slice(0, 10)
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

// Two dates, so the prev/next buttons have somewhere to go and the surge
// comparison has a previous day to compare against. Newest first, matching
// fetchAvailableDates()'s ordering.
export const COLLECTED_DATES: CollectedDateRow[] = [
  { collected_date: todayInSeoul() },
  { collected_date: previousDayInSeoul() },
]

export type WordCountRow = { collected_date: string; word: string; count: number }

// Headlines collected each day — the denominator computeSurges normalises by,
// served through the content-range header the way a PostgREST head-count is.
// Today is the larger of the two, so a word has to gain share rather than
// merely gain count to be marked.
export const HEADLINE_COUNTS: Record<string, number> = {
  [todayInSeoul()]: 12,
  [previousDayInSeoul()]: 8,
}

// daily_word_counts rows for the two days above, which is what computeSurges
// compares. Counts match DEFAULT_GRAPH's so the two fixtures tell one story.
//
// Shares of the day, not raw counts: 예산안 goes from 1/8 to 5/12 of the day —
// 3.3x — and is the one word marked. 여야 holds its count of 3 while the day
// grows from 8 headlines to 12, so its share falls and it is not marked, which
// is the distinction raw counts would miss.
export const WORD_COUNTS: WordCountRow[] = [
  { collected_date: todayInSeoul(), word: '예산안', count: 5 },
  { collected_date: todayInSeoul(), word: '여야', count: 3 },
  { collected_date: todayInSeoul(), word: '국회', count: 2 },
  { collected_date: todayInSeoul(), word: '한파', count: 2 },
  { collected_date: previousDayInSeoul(), word: '예산안', count: 1 },
  { collected_date: previousDayInSeoul(), word: '여야', count: 3 },
  { collected_date: previousDayInSeoul(), word: '국회', count: 2 },
  { collected_date: previousDayInSeoul(), word: '한파', count: 2 },
]

// Shape matches the json_build_object in keyword_graph. The signal fields are
// not read by the layout, only shown in the tooltip, but they are here so the
// fixture stays a faithful copy of what the RPC returns.
export type GraphNodeRow = {
  word: string
  count: number
  spec: number | null
  standalone: number | null
  neighbors_per_doc: number | null
  assoc: number | null
  passed_by: string
  category_slug: string
  faded: boolean
}
export type GraphEdgeRow = { a: string; b: string; cooc: number; npmi: number }
export type GraphPayload = { nodes: GraphNodeRow[]; edges: GraphEdgeRow[] }

function node(
  word: string,
  count: number,
  category_slug: string,
  overrides: Partial<GraphNodeRow> = {},
): GraphNodeRow {
  return {
    word,
    count,
    spec: 0.5,
    standalone: 0.9,
    neighbors_per_doc: 1.5,
    assoc: 0.6,
    passed_by: 'length',
    category_slug,
    faded: false,
    ...overrides,
  }
}

// 국회 is deliberately left out of the edge list: the focus-mode test needs a
// word that is not a neighbour of 예산안, and on real days most words are
// isolated anyway (34 of 74 had any edge on 2026-08-01).
export const DEFAULT_GRAPH: GraphPayload = {
  nodes: [
    node('예산안', 5, 'politics'),
    node('여야', 3, 'politics'),
    node('국회', 2, 'politics'),
    node('한파', 2, 'society', { faded: true, passed_by: 'neighbors' }),
  ],
  edges: [{ a: '예산안', b: '여야', cooc: 3, npmi: 0.8 }],
}

export const ECONOMY_GRAPH: GraphPayload = {
  nodes: [node('금리', 4, 'economy'), node('환율', 2, 'economy')],
  edges: [],
}

export const EMPTY_GRAPH: GraphPayload = { nodes: [], edges: [] }

// Shape matches the nested select in fetchHeadlinesForWord(). Two sections, so
// the panel's badges and its section-then-title ordering are observable — the
// economy row is listed first here and must render second.
export const HEADLINE_ROWS: HeadlineNounRow[] = [
  {
    word: '예산안',
    headlines: {
      id: '00000000-0000-4000-8000-00000000aaa2',
      title: '예산안 국채 발행 규모 확정',
      link: 'https://n.news.naver.com/article/001/0000000002',
      collected_date: todayInSeoul(),
      categories: { slug: 'economy' },
    },
  },
  {
    word: '예산안',
    headlines: {
      id: '00000000-0000-4000-8000-00000000aaa1',
      title: '여야 예산안 처리 합의',
      link: 'https://n.news.naver.com/article/001/0000000001',
      collected_date: todayInSeoul(),
      categories: { slug: 'politics' },
    },
  },
]
