export type CategoryRow = { id: string; slug: string; label: string }
export type CollectedDateRow = { collected_date: string; headline_count: number }
export type HeadlineSummary = {
  id: string
  title: string
  link: string
  category_slug: string
}
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

export type WordCountRow = { collected_date: string; word: string; count: number }

// Headlines collected each day — the denominator computeSurges normalises by.
// Today is the larger of the two, so a word has to gain share rather than
// merely gain count to be marked.
//
// The app reads these from collected_dates now; the head-count endpoint they
// used to be served through is the fallback for a date that view did not
// return, and `headlines` in MockOptions still answers it.
export const HEADLINE_COUNTS: Record<string, number> = {
  [todayInSeoul()]: 12,
  [previousDayInSeoul()]: 8,
}

// Two dates, so the prev/next buttons have somewhere to go and the surge
// comparison has a previous day to compare against. Newest first, matching
// fetchCollectedDates()'s ordering.
//
// The counts are read from HEADLINE_COUNTS rather than written out again: the
// two fixtures are the same day totals reached by two routes, and a copy that
// drifted would make the surge assertions describe a day that does not exist.
export const COLLECTED_DATES: CollectedDateRow[] = [
  { collected_date: todayInSeoul(), headline_count: HEADLINE_COUNTS[todayInSeoul()] },
  { collected_date: previousDayInSeoul(), headline_count: HEADLINE_COUNTS[previousDayInSeoul()] },
]

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

// 두 사건과 그 사이의 다리 하나.
//
//   사건 A: 예산안 — 여야 — 국회   (삼각형)
//   사건 B: 폭염 — 열대야 — 양산   (삼각형)
//   다리:   국회 — 폭염            (약한 엣지 하나)
//
// 삼각형 안은 npmi를 높게, 다리는 낮게 주어 루뱅이 둘로 가르도록 한다. 엣지가
// 하나뿐이므로 합치기 문턱 2에 걸리지 않고, 그래서 국회와 폭염이 다리가 된다 —
// 다리는 예외 없이 합치기가 "안 합친다"고 판정한 쌍이다.
export const EVENT_GRAPH: GraphPayload = {
  nodes: [
    node('예산안', 9, 'politics'),
    node('여야', 7, 'politics'),
    node('국회', 6, 'politics'),
    node('폭염', 8, 'society'),
    node('열대야', 5, 'society'),
    node('양산', 4, 'society'),
    // 어디에도 붙지 않는 단어. 실제 하루의 3분의 1이 이렇고, 사건에 속하지
    // 않으므로 다리도 될 수 없다.
    node('까마귀', 3, 'culture'),
  ],
  edges: [
    { a: '예산안', b: '여야', cooc: 6, npmi: 0.92 },
    { a: '예산안', b: '국회', cooc: 5, npmi: 0.9 },
    { a: '여야', b: '국회', cooc: 5, npmi: 0.9 },
    { a: '폭염', b: '열대야', cooc: 5, npmi: 0.92 },
    { a: '폭염', b: '양산', cooc: 4, npmi: 0.9 },
    { a: '열대야', b: '양산', cooc: 4, npmi: 0.9 },
    { a: '국회', b: '폭염', cooc: 2, npmi: 0.32 },
  ],
}

// event_headline_counts의 답. 단어별 카운트의 합(A는 22, B는 17)과 일부러 다르게
// 두어, 화면의 숫자가 합계가 아니라 이 값에서 오는 것이 관측 가능하도록 한다.
// 순서는 입력 순서이므로, 목이 본문의 p_events를 읽어 사건을 알아본다.
export const EVENT_HEADLINE_COUNTS: Record<string, number> = {
  예산안: 12,
  폭염: 11,
}

// event_headlines의 답. 두 섹션이라 패널의 뱃지와 정렬이 관측된다.
export const EVENT_HEADLINE_ROWS: Record<string, HeadlineSummary[]> = {
  예산안: [
    {
      id: '00000000-0000-4000-8000-00000000bbb1',
      title: '국회 예산안 심사 착수',
      link: 'https://n.news.naver.com/article/001/0000000011',
      category_slug: 'politics',
    },
    {
      id: '00000000-0000-4000-8000-00000000bbb2',
      title: '여야 예산안 협상 재개',
      link: 'https://n.news.naver.com/article/001/0000000012',
      category_slug: 'politics',
    },
  ],
  폭염: [
    {
      id: '00000000-0000-4000-8000-00000000bbb3',
      title: '폭염 특보 전국 확대',
      link: 'https://n.news.naver.com/article/001/0000000013',
      category_slug: 'society',
    },
  ],
}
