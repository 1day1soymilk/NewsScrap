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

  const { data, error } = await query
  if (error) throw queryError(error)

  const seen = new Set<string>()
  const results: HeadlineSummary[] = []
  for (const row of (data ?? []) as unknown as { headlines: HeadlineSummary }[]) {
    const headline = row.headlines
    if (seen.has(headline.id)) continue
    seen.add(headline.id)
    results.push(headline)
  }
  return results
}
