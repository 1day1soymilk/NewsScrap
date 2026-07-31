import { supabase } from './supabaseClient'
import type { Category, HeadlineSummary, WordCount } from './types'

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('id, slug, label').order('label')
  if (error) throw error
  return (data ?? []) as Category[]
}

export async function fetchAvailableDates(): Promise<string[]> {
  const { data, error } = await supabase
    .from('headlines')
    .select('collected_date')
    .order('collected_date', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as { collected_date: string }[]
  return Array.from(new Set(rows.map((row) => row.collected_date)))
}

export async function fetchWordCounts(
  date: string,
  categorySlug: string | null,
): Promise<WordCount[]> {
  let query = supabase
    .from('headline_nouns')
    .select('word, headlines!inner(collected_date, categories!inner(slug))')
    .eq('headlines.collected_date', date)

  if (categorySlug) {
    query = query.eq('headlines.categories.slug', categorySlug)
  }

  const { data, error } = await query
  if (error) throw error

  const counts = new Map<string, number>()
  for (const row of (data ?? []) as { word: string }[]) {
    counts.set(row.word, (counts.get(row.word) ?? 0) + 1)
  }

  return Array.from(counts, ([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count)
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
  if (error) throw error

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
