import { cachedQuery } from './queryCache'
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

export interface CollectedDate {
  date: string
  /** Every headline of that day, all six sections. The denominator the surge comparison divides by. */
  headlines: number
}

// One row per collected day, newest first. The count rides along because the
// surge comparison needs it for two days at once and this query is issued on
// every load anyway; before this it cost two `HEAD ... count=exact` requests.
//
// **Cached, and it stopped being "read once at mount" — which is what its
// comment used to say and what stopped being true.** Two callers want this
// answer now: App, for the date stepper and the surge denominators, and
// `main.tsx`, which needs it before React mounts because the day the app opens
// on is decided from it (`src/lib/openingDate.ts`). Measured on a cold load
// with the pre-mount call added and no cache, the dev server issued
// `collected_dates` **three** times.
//
// The key is a constant because there are no arguments. That is the whole
// point: every caller asks the same question and gets the same promise, so the
// pre-mount call moves the request earlier instead of adding one.
export const fetchCollectedDates = cachedQuery(
  () => 'collected-dates',
  async (): Promise<CollectedDate[]> => {
    const { data, error } = await supabase
      .from('collected_dates')
      .select('collected_date, headline_count')
      .order('collected_date', { ascending: false })
    if (error) throw queryError(error)

    // The view groups by collected_date, so unlike the `select distinct` it
    // replaced it cannot hand back a repeat and there is nothing to dedupe.
    const rows = (data ?? []) as { collected_date: string; headline_count: number | string }[]
    return rows.map((row) => ({ date: row.collected_date, headlines: Number(row.headline_count) }))
  },
)

export interface CategoryShare {
  slug: string
  /** Headlines that section produced that day, all runs summed. */
  headlines: number
  /**
   * Did any single run store a full `collect_cap` window? If so this section's
   * share is a lower bound rather than the whole of what it published.
   */
  capped: boolean
}

// What each section actually produced on a day — the proportions the ranking
// deliberately stops showing.
//
// 하루 여섯 행이므로 **날짜로 반드시 거른다.** 거르지 않으면 166일 만에
// PostgREST의 1,000행 상한에 닿고, 잘린 응답으로 계산한 비율은 아무 말도 없이
// 틀린다 — 이 저장소가 이미 한 번 값을 치른 실패다.
//
// Cached for the reason the rest are: the date is stepped there and back, and
// what matters is that the same array comes back so the donut is not rebuilt.
export const fetchCategoryShare = cachedQuery(
  (date: string) => `category-share|${date}`,
  async (date: string): Promise<CategoryShare[]> => {
    const { data, error } = await supabase
      .from('daily_category_counts')
      .select('slug, headlines, capped')
      .eq('date', date)
    if (error) throw queryError(error)

    const rows = (data ?? []) as { slug: string; headlines: number | string; capped: boolean }[]
    return rows.map((row) => ({
      slug: row.slug,
      headlines: Number(row.headlines),
      capped: row.capped,
    }))
  },
)

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
//
// Cached, and it has to be: stepping to a date and back keeps the identity of
// `graphWords` but changes `selectedDate`, so the surge effect re-runs anyway.
// Measured — before this was cached it was the only request still going out on
// a return trip.
export const fetchWordCountsFor = cachedQuery(
  (dates: string[], words: string[]) => `word-counts|${dates.join(',')}|${words.join(',')}`,
  async (dates: string[], words: string[]): Promise<Map<string, WordCount[]>> => {
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
  },
)

// Headlines collected on a day, as a server-side count: `head` means no rows
// come back at all, so the 1,000-row cap cannot apply. This is the denominator
// that makes two days comparable — 2026-08-01 was collected twice and holds
// 1,144 headlines against 2026-07-31's 899.
export const fetchHeadlineCount = cachedQuery(
  (date: string) => `headline-count|${date}`,
  async (date: string): Promise<number> => {
    const { count, error } = await supabase
      .from('headlines')
      .select('*', { count: 'exact', head: true })
      .eq('collected_date', date)
    if (error) throw queryError(error)
    return count ?? 0
  },
)

// An RPC rather than a view because the node and edge cuts and the NPMI
// arithmetic have to happen server side: a day's word pairs run to thousands of
// rows even after grouping, and PostgREST would truncate at 1000.
//
// Postgres renders numeric as a bare JSON number, so these arrive as JS numbers
// already; the coercion is here for the same reason fetchWordCounts has it —
// nothing downstream should have to wonder.
// This is the one whose caching pays for the rest. Handing back the same object
// keeps the identity of `graph` in App.tsx, and everything downstream is then
// skipped: the three surge requests, 70 canvas text measurements, the Louvain
// partition, the 300-tick simulation, the edge routing, and event_headline_counts.
export const fetchKeywordGraph = cachedQuery(
  (date: string, categorySlug: string | null) => `graph|${date}|${categorySlug ?? '*'}`,
  async (date: string, categorySlug: string | null): Promise<KeywordGraphData> => {
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
  },
)

// assoc is null for a word that never shares a headline, and spec is null when
// the categories table holds a single row. Number(null) is 0, which would read
// as a measured zero rather than as "not measured".
function numeric(value: number | null): number | null {
  return value === null || value === undefined ? null : Number(value)
}

// A word appears in a few dozen headlines on a busy day, so this is a safety
// cap rather than a semantic cut: it exists so that a pathological word — or a
// day collected several times over — cannot pull thousands of rows into the
// panel. It has to stay far above any real value, because the sort happens
// after the fetch and a limit that ever bites would silently change the list.
//
// **It was 200 and that had stopped being far above anything.** Measured on the
// live archive 2026-08-08, worst (word, day) cell: 폭염 on 2026-08-07 returns
// **198 rows** for 194 distinct headlines. Two rows of headroom, and nothing
// would have said so — the panel would simply have shown 194 of 195 one day.
//
// **What moves this number is `scoring_weights.collect_cap`, not the word.** The
// cap went 150 → 300 on 2026-08-07 and the day went to 4,218 headlines; the
// biggest word takes about 4.7% of a day, so a cap that doubles again puts the
// worst cell near 400. 600 is three times the measured worst and covers that
// doubling. This is the same shape as `MAX_LIST_PAGES` in the collector — a
// second limit nobody chose, which surfaces as a short list rather than as
// anything named — so it is written down here beside the measurement that sets
// it rather than left as a round number.
const HEADLINE_ROW_LIMIT = 600

interface HeadlineRow {
  headlines: {
    id: string
    title: string
    link: string
    collected_date: string
    categories: { slug: string }
  }
}

export const fetchHeadlinesForWord = cachedQuery(
  (date: string, categorySlug: string | null, word: string) =>
    `word-headlines|${date}|${categorySlug ?? '*'}|${word}`,
  async (
    date: string,
    categorySlug: string | null,
    word: string,
  ): Promise<HeadlineSummary[]> => {
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
  },
)

// Deduplicated headline counts, one per event. An RPC for the same reason
// keyword_graph is one: PostgREST cannot express count(distinct …), and reading
// headline_nouns to uniquify on the client risks a response truncated at 1,000
// rows with nothing saying so — the biggest event on 2026-08-02 is already 164
// rows, and that number grows with an event's member count.
//
// Every event of the day is counted in one call. Cutting to the top five first
// would rank them on summed member counts, which is the very value this exists
// to correct.
//
// The event composition is part of the key. A different partition is a different
// answer, and since position is identity, an answer computed for someone else's
// composition does not look wrong on screen.
export const fetchEventHeadlineCounts = cachedQuery(
  (date: string, categorySlug: string | null, events: string[][]) =>
    `event-counts|${date}|${categorySlug ?? '*'}|${events.map((e) => e.join(',')).join(';')}`,
  async (
    date: string,
    categorySlug: string | null,
    events: string[][],
  ): Promise<number[]> => {
    if (events.length === 0) return []

    const { data, error } = await supabase.rpc('event_headline_counts', {
      p_date: date,
      p_category: categorySlug,
      p_events: events,
    })
    if (error) throw queryError(error)

    const counts = (data ?? []) as number[]
    // Position is identity. Using a misaligned response pins one event's count
    // onto another, and that does not look wrong on screen. Fail loudly instead.
    if (counts.length !== events.length) {
      throw new Error(
        `event_headline_counts가 ${events.length}개를 물었는데 ${counts.length}개를 돌려줬습니다`,
      )
    }
    return counts.map((count) => Number(count))
  },
)

// One event's headlines. Reusing fetchHeadlinesForWord's 200-row cap here would
// leave 22% of headroom — a 74-headline event already consumes 164 rows — so
// rather than raising the cap, the server uniquifies and the cap goes away.
export const fetchHeadlinesForEvent = cachedQuery(
  (date: string, categorySlug: string | null, words: string[]) =>
    `event-headlines|${date}|${categorySlug ?? '*'}|${words.join(',')}`,
  async (
    date: string,
    categorySlug: string | null,
    words: string[],
  ): Promise<HeadlineSummary[]> => {
    if (words.length === 0) return []

    const { data, error } = await supabase.rpc('event_headlines', {
      p_date: date,
      p_category: categorySlug,
      p_words: words,
    })
    if (error) throw queryError(error)

    return (data ?? []) as HeadlineSummary[]
  },
)

export interface WordMatch {
  word: string
  /** Headline rows holding this word, across the whole archive. */
  total: number
  /** Collected days it appeared on. */
  days: number
  /** The most recent of those days. */
  lastDate: string
}

/** Result rows shown for one search. Twenty fills the list without paging it. */
const SEARCH_LIMIT = 20

// `%`, `_` and `*` are wildcards by the time a term reaches Postgres — PostgREST
// rewrites `*` into `%` before Postgres sees the pattern — so escaping them
// correctly means escaping at two layers with two sets of rules. They are
// stripped instead, which is one rule in one place. The cost was counted rather
// than waved away: of 19,767 words, **two** contain `%` (0.45%포인트, 1%포인트)
// and **none** contain `_` or `*`, and both of those two are still reachable by
// searching 포인트. Left alone, a lone `_` matches every one-character word in
// the archive.
function stripWildcards(term: string): string {
  return term.replace(/[%_*\\]/g, '')
}

// Substring search over the whole archive, against the materialised directory
// from migration 0030 rather than against headline_nouns.
//
// `word like '%…%'` uses no index at any anchoring, so searching the noun rows
// reads all 114,457 of them — 316 ms measured — and that cost grows with
// headline volume. The directory is ~19,767 rows and grows with vocabulary
// instead: measured live, ~35 ms warm and ~60 ms cold — a seq scan too, just
// over two orders of magnitude fewer rows — still about 9x cheaper than
// searching headline_nouns directly.
//
// Ordered by total, then by the last day it appeared on, then by the word so a
// tie is broken the same way every time. `last_date` deliberately does not
// outrank `total`: a recency-weighted score would be a ranking invented here
// with nothing to measure it against, and the trajectory answers that question
// properly one click later.
//
// Cached because a reader types, deletes a character and types it again.
export const searchWords = cachedQuery(
  (query: string) => `word-search|${stripWildcards(query.trim())}`,
  async (query: string): Promise<WordMatch[]> => {
    const term = stripWildcards(query.trim())
    if (term === '') return []

    const { data, error } = await supabase
      .from('word_directory')
      .select('word, total, days, last_date')
      .ilike('word', `%${term}%`)
      .order('total', { ascending: false })
      .order('last_date', { ascending: false })
      .order('word')
      .limit(SEARCH_LIMIT)
    if (error) throw queryError(error)

    const rows = (data ?? []) as {
      word: string
      total: number | string
      days: number | string
      last_date: string
    }[]
    return rows.map((row) => ({
      word: row.word,
      total: Number(row.total),
      days: Number(row.days),
      lastDate: row.last_date,
    }))
  },
)
