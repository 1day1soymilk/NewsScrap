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

export type CategoryShareRow = { date: string; slug: string; headlines: number; capped: boolean }

// daily_category_counts rows. **The day's total is read from COLLECTED_DATES
// rather than written out again**: the donut's shares are that day's headlines
// split six ways, and a copy that drifted would put a chart on screen describing
// a day that does not exist — the same rule COLLECTED_DATES itself follows.
//
// The split is fixed weights so the percentages are stated rather than emergent,
// and society is marked `capped` on today only, so one assertion can show the
// caveat appearing and another can show it staying away.
const SHARE_WEIGHTS: [string, number, boolean][] = [
  ['society', 4, true],
  ['politics', 3, false],
  ['economy', 2, false],
  ['culture', 1, false],
  ['world', 1, false],
  ['it', 1, false],
]

// The remainder goes to the first (largest) section so the six rows sum to the
// day's total exactly. A fixture whose parts do not add up to its own whole is a
// day that does not exist, which is the thing deriving it was meant to prevent.
function shareFor(date: string, capped: boolean): CategoryShareRow[] {
  const total = HEADLINE_COUNTS[date] ?? 0
  const weight = SHARE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0)
  const rows = SHARE_WEIGHTS.map(([slug, w, isCapped]) => ({
    date,
    slug,
    headlines: Math.floor((total * w) / weight),
    capped: capped && isCapped,
  }))
  rows[0].headlines += total - rows.reduce((sum, row) => sum + row.headlines, 0)
  return rows
}

export const CATEGORY_SHARE: CategoryShareRow[] = [
  ...shareFor(todayInSeoul(), true),
  ...shareFor(previousDayInSeoul(), false),
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

// Eight disjoint pairs, so Louvain gives eight communities and the merge rule —
// which wants two edges between two communities — cannot join any of them. That
// is three more events than the collapsed list holds, which is what makes the
// expand toggle observable. EVENT_GRAPH's two events never reach the limit.
//
// 가N always outranks 나N inside its pair, so 가N is the event's first word and
// the one MANY_EVENT_HEADLINE_COUNTS is keyed by.
// 정육면체 위상 — 여덟 단어가 네 개씩 두 고리를 이루고 마주 보는 자리끼리 이어진다.
//
// **이 픽스처가 있는 이유는 다른 픽스처가 새 배치 경로를 하나도 안 밟기 때문이다.**
// DEFAULT_GRAPH는 사건 멤버가 둘이라 "둘이면 나란히" 분기로 빠지고,
// EVENT_GRAPH의 삼각형은 교차가 0이라 layoutCluster가 즉시 반환하며,
// MANY_EVENTS_GRAPH는 쌍 여덟 개라 역시 나란히다. 그래서 planar.ts는 브라우저에서
// 한 번도 실행된 적이 없었고, e2e 40개가 초록인 것이 새 코드에 대해 아무 말도
// 하지 않았다.
//
// 정육면체는 평면 그래프인데 힘 균형으로 놓으면 **교차가 23개** 나온다(측정값).
// 즉 layoutCluster의 `forced > 0` 분기가 반드시 열리고, nearPlanarPositions →
// triangulate → tutte → spreadPlanar가 전부 돈 뒤 0이 되어야 한다. 이 하나로
// 새 경로 전체가 브라우저에서 실행된다.
//
// 단어는 두 섹션에 걸친다 — 한 섹션이면 색이 하나뿐이라 그림이 실제 화면과
// 덜 닮는다. count는 전부 다르게 두어 글자 크기가 제각각이고, 그래야 라벨 폭
// 편차가 있는 상태에서 겹침을 본다.
export const DENSE_GRAPH: GraphPayload = {
  nodes: [
    node('예산안', 12, 'politics'),
    node('국회', 11, 'politics'),
    node('본회의', 10, 'politics'),
    node('여야', 9, 'politics'),
    node('물가', 8, 'economy'),
    node('환율', 7, 'economy'),
    node('금리', 6, 'economy'),
    node('수출', 5, 'economy'),
  ],
  edges: [
    // 바깥 고리
    { a: '예산안', b: '국회', cooc: 6, npmi: 0.9 },
    { a: '국회', b: '본회의', cooc: 6, npmi: 0.9 },
    { a: '본회의', b: '여야', cooc: 6, npmi: 0.9 },
    { a: '여야', b: '예산안', cooc: 6, npmi: 0.9 },
    // 안쪽 고리
    { a: '물가', b: '환율', cooc: 5, npmi: 0.88 },
    { a: '환율', b: '금리', cooc: 5, npmi: 0.88 },
    { a: '금리', b: '수출', cooc: 5, npmi: 0.88 },
    { a: '수출', b: '물가', cooc: 5, npmi: 0.88 },
    // 기둥
    { a: '예산안', b: '물가', cooc: 4, npmi: 0.85 },
    { a: '국회', b: '환율', cooc: 4, npmi: 0.85 },
    { a: '본회의', b: '금리', cooc: 4, npmi: 0.85 },
    { a: '여야', b: '수출', cooc: 4, npmi: 0.85 },
  ],
}

export const MANY_EVENTS_GRAPH: GraphPayload = {
  nodes: Array.from({ length: 8 }, (_, i) => [
    node(`가${i}`, 20 - i, 'politics'),
    node(`나${i}`, 12 - i, 'politics'),
  ]).flat(),
  edges: Array.from({ length: 8 }, (_, i) => ({
    a: `가${i}`,
    b: `나${i}`,
    cooc: 5,
    npmi: 0.9,
  })),
}

// Distinct per event, so the ranking has no ties to resolve and the list's order
// is the one this file states rather than whatever the sort happened to keep.
export const MANY_EVENT_HEADLINE_COUNTS: Record<string, number> = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [`가${i}`, 30 - i * 2]),
)

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
