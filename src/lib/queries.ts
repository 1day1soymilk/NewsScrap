import { supabase } from './supabaseClient'
import type {
  Category,
  GraphEdge,
  GraphNode,
  HeadlineSummary,
  KeywordGraphData,
  WordCount,
} from './types'

interface PostgrestErrorLike {
  message?: string
  details?: string
  hint?: string
  code?: string
}

// supabase-js hands back a plain object, not an Error, so throwing it directly
// makes every failure render as "[object Object]" in the UI.
function queryError(error: PostgrestErrorLike): Error {
  const message = error.message ?? JSON.stringify(error)
  return new Error(error.code ? `${message} (${error.code})` : message)
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, label')
    .order('section_id')
  if (error) throw queryError(error)
  return (data ?? []) as Category[]
}

export async function fetchAvailableDates(): Promise<string[]> {
  const { data, error } = await supabase
    .from('collected_dates')
    .select('collected_date')
    .order('collected_date', { ascending: false })
  if (error) throw queryError(error)
  const rows = (data ?? []) as { collected_date: string }[]
  return Array.from(new Set(rows.map((row) => row.collected_date)))
}

export async function fetchWordCounts(
  date: string,
  categorySlug: string | null,
): Promise<WordCount[]> {
  // daily_word_counts aggregates in Postgres; rows where category_slug is null
  // are the all-categories rollup.
  let query = supabase
    .from('daily_word_counts')
    .select('word, count')
    .eq('collected_date', date)

  query = categorySlug
    ? query.eq('category_slug', categorySlug)
    : query.is('category_slug', null)

  const { data, error } = await query.order('count', { ascending: false })
  if (error) throw queryError(error)

  const rows = (data ?? []) as { word: string; count: number }[]
  return rows
    .map((row) => ({ word: row.word, count: Number(row.count) }))
    .sort((a, b) => b.count - a.count)
}

// Counts for a named set of words across a named set of days.
//
// The surge comparison must not read fetchWordCounts and sum it: a day holds
// 3,289 distinct words and PostgREST caps a response at 1,000, so that sum is
// silently a sum of the top 1,000. Measured on 2026-08-01 against 2026-07-31,
// the truncated denominators inflated every ratio by 11% and turned 12 of the
// 110 drawn words into false "new"s. Naming the words bounds the response by
// render_cap (130) instead, which cannot be truncated.
export async function fetchWordCountsFor(
  dates: string[],
  words: string[],
): Promise<Map<string, WordCount[]>> {
  const byDate = new Map<string, WordCount[]>(dates.map((date) => [date, []]))
  if (dates.length === 0 || words.length === 0) return byDate

  const { data, error } = await supabase
    .from('daily_word_counts')
    .select('collected_date, word, count')
    .in('collected_date', dates)
    .in('word', words)
    .is('category_slug', null)
  if (error) throw queryError(error)

  const rows = (data ?? []) as { collected_date: string; word: string; count: number }[]
  for (const row of rows) {
    byDate.get(row.collected_date)?.push({ word: row.word, count: Number(row.count) })
  }
  return byDate
}

// Headlines collected on a day, as a server-side count: `head` means no rows
// come back at all, so the 1,000-row cap cannot apply. This is the denominator
// that makes two days comparable — 2026-08-01 was collected twice and holds
// 1,144 headlines against 2026-07-31's 899.
export async function fetchHeadlineCount(date: string): Promise<number> {
  const { count, error } = await supabase
    .from('headlines')
    .select('*', { count: 'exact', head: true })
    .eq('collected_date', date)
  if (error) throw queryError(error)
  return count ?? 0
}

// An RPC rather than a view because the node and edge cuts and the NPMI
// arithmetic have to happen server side: a day's word pairs run to thousands of
// rows even after grouping, and PostgREST would truncate at 1000.
//
// Postgres renders numeric as a bare JSON number, so these arrive as JS numbers
// already; the coercion is here for the same reason fetchWordCounts has it —
// nothing downstream should have to wonder.
export async function fetchKeywordGraph(
  date: string,
  categorySlug: string | null,
): Promise<KeywordGraphData> {
  const { data, error } = await supabase.rpc('keyword_graph', {
    p_date: date,
    p_category: categorySlug,
  })
  if (error) throw queryError(error)

  const raw = (data ?? { nodes: [], edges: [] }) as {
    nodes?: GraphNode[]
    edges?: GraphEdge[]
  }

  return {
    nodes: (raw.nodes ?? []).map((node) => ({
      ...node,
      count: Number(node.count),
      spec: numeric(node.spec),
      standalone: numeric(node.standalone),
      neighbors_per_doc: numeric(node.neighbors_per_doc),
      assoc: numeric(node.assoc),
    })),
    edges: (raw.edges ?? []).map((edge) => ({
      ...edge,
      cooc: Number(edge.cooc),
      npmi: Number(edge.npmi),
    })),
  }
}

// assoc is null for a word that never shares a headline, and spec is null when
// the categories table holds a single row. Number(null) is 0, which would read
// as a measured zero rather than as "not measured".
function numeric(value: number | null): number | null {
  return value === null || value === undefined ? null : Number(value)
}

// A word appears in a few dozen headlines on a busy day, so this is a safety
// cap rather than a semantic cut: it exists so that a pathological word — or a
// day collected several times over — cannot pull thousands of rows into the
// panel. It is deliberately far above any real value, because the sort happens
// after the fetch and a limit that ever bites would silently change the list.
const HEADLINE_ROW_LIMIT = 200

interface HeadlineRow {
  headlines: {
    id: string
    title: string
    link: string
    collected_date: string
    categories: { slug: string }
  }
}

export async function fetchHeadlinesForWord(
  date: string,
  categorySlug: string | null,
  word: string,
): Promise<HeadlineSummary[]> {
  let query = supabase
    .from('headline_nouns')
    .select('word, headlines!inner(id, title, link, collected_date, categories!inner(slug))')
    .eq('word', word)
    .eq('headlines.collected_date', date)

  if (categorySlug) {
    query = query.eq('headlines.categories.slug', categorySlug)
  }

  const { data, error } = await query.limit(HEADLINE_ROW_LIMIT)
  if (error) throw queryError(error)

  // The same headline can carry the word twice (ETRI returns a noun per
  // occurrence), so rows are deduplicated on the headline id.
  const seen = new Set<string>()
  const results: HeadlineSummary[] = []
  for (const row of (data ?? []) as unknown as HeadlineRow[]) {
    const headline = row.headlines
    if (seen.has(headline.id)) continue
    seen.add(headline.id)
    results.push({
      id: headline.id,
      title: headline.title,
      link: headline.link,
      category_slug: headline.categories.slug,
    })
  }
  return results
}

// 사건별 중복 제거 기사 수. RPC인 이유는 keyword_graph와 같다: count(distinct …)를
// PostgREST가 표현할 수 없고, headline_nouns를 읽어 클라이언트에서 유일화하면
// 응답이 1000행에 잘릴 수 있는데 잘려도 아무도 모른다 — 2026-08-02의 가장 큰
// 사건이 이미 164행이고 이 수는 사건의 단어 수와 함께 자란다.
//
// 하루의 사건 전부를 한 번에 묻는다. 상위 5개를 먼저 자르면 순위가 멤버 카운트의
// 합으로 정해지는데, 그 합이 바로 이 함수가 고치려는 값이다.
export async function fetchEventHeadlineCounts(
  date: string,
  categorySlug: string | null,
  events: string[][],
): Promise<number[]> {
  if (events.length === 0) return []

  const { data, error } = await supabase.rpc('event_headline_counts', {
    p_date: date,
    p_category: categorySlug,
    p_events: events,
  })
  if (error) throw queryError(error)

  const counts = (data ?? []) as number[]
  // 순서가 곧 신원이다. 어긋난 응답을 쓰면 사건에 남의 기사 수가 붙고, 그것은
  // 화면에서 틀려 보이지 않는다.
  if (counts.length !== events.length) {
    throw new Error(
      `event_headline_counts가 ${events.length}개를 물었는데 ${counts.length}개를 돌려줬습니다`,
    )
  }
  return counts.map((count) => Number(count))
}

// 한 사건의 헤드라인. fetchHeadlinesForWord의 200행 상한을 여기 그대로 쓰면
// 74건짜리 사건이 164행을 소비해 여유가 22%밖에 없으므로, 상한을 올리는 대신
// 서버에서 유일화해 상한 자체를 없앤다.
export async function fetchHeadlinesForEvent(
  date: string,
  categorySlug: string | null,
  words: string[],
): Promise<HeadlineSummary[]> {
  if (words.length === 0) return []

  const { data, error } = await supabase.rpc('event_headlines', {
    p_date: date,
    p_category: categorySlug,
    p_words: words,
  })
  if (error) throw queryError(error)

  return (data ?? []) as HeadlineSummary[]
}
