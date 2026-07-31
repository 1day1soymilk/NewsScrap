// supabase/functions/collect-headlines/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CATEGORIES } from './lib/categories.ts'
import { extractHeadlines } from './lib/headlines.ts'
import { callEtriMorphAnalysis, extractNouns, filterNouns } from './lib/nouns.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ETRI_API_KEY = Deno.env.get('ETRI_API_KEY')!

// Each headline costs one synchronous ETRI round trip (~0.5s) plus a few DB
// calls. A Naver section page yields 60-100 anchors, and six categories of that
// would blow past the Edge Function wall-clock limit, so cap the work per run.
const MAX_HEADLINES_PER_CATEGORY = 40

function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

async function analyseNouns(title: string): Promise<string[]> {
  return filterNouns(extractNouns(await callEtriMorphAnalysis(title, ETRI_API_KEY)))
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const collectedDate = todayInSeoul()
  const summary: Record<string, string> = {}

  for (const category of CATEGORIES) {
    try {
      const { data: categoryRow, error: categoryError } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', category.slug)
        .single()

      if (categoryError || !categoryRow) {
        throw new Error(`category "${category.slug}" not found in DB — did the migration run?`)
      }

      const pageResponse = await fetch(`https://news.naver.com/section/${category.sectionId}`)
      if (!pageResponse.ok) {
        throw new Error(`section fetch failed with status ${pageResponse.status}`)
      }
      const html = await pageResponse.text()
      const headlines = extractHeadlines(html)
      const candidates = headlines.slice(0, MAX_HEADLINES_PER_CATEGORY)

      let storedCount = 0
      let repairedCount = 0

      for (const headline of candidates) {
        try {
          const { data: existing, error: lookupError } = await supabase
            .from('headlines')
            .select('id')
            .eq('category_id', categoryRow.id)
            .eq('link', headline.link)
            .maybeSingle()
          if (lookupError) throw lookupError

          if (existing) {
            // Self-healing: an earlier run may have been interrupted between the
            // headline insert and the noun insert, leaving a headline that is
            // invisible to the word cloud. Backfill it instead of skipping.
            const { count, error: countError } = await supabase
              .from('headline_nouns')
              .select('id', { count: 'exact', head: true })
              .eq('headline_id', existing.id)
            if (countError) throw countError
            if ((count ?? 0) > 0) continue

            const nouns = await analyseNouns(headline.title)
            if (nouns.length === 0) continue

            const { error: backfillError } = await supabase
              .from('headline_nouns')
              .insert(nouns.map((word) => ({ headline_id: existing.id, word })))
            if (backfillError) throw backfillError
            repairedCount += 1
            continue
          }

          // Nouns first: if ETRI fails or yields nothing usable we leave no row
          // behind, so the next run re-scrapes this link and retries naturally.
          const nouns = await analyseNouns(headline.title)
          if (nouns.length === 0) continue

          const { data: inserted, error: insertError } = await supabase
            .from('headlines')
            .insert({
              category_id: categoryRow.id,
              title: headline.title,
              link: headline.link,
              collected_date: collectedDate,
            })
            .select('id')
            .single()
          if (insertError) throw insertError

          const { error: nounsError } = await supabase
            .from('headline_nouns')
            .insert(nouns.map((word) => ({ headline_id: inserted.id, word })))
          if (nounsError) throw nounsError
          storedCount += 1
        } catch (headlineError) {
          console.error(`Failed to process headline "${headline.link}":`, headlineError)
        }
      }

      summary[category.slug] =
        `ok: ${headlines.length} seen, ${candidates.length} processed, ` +
        `${storedCount} new, ${repairedCount} repaired`
    } catch (categoryError) {
      console.error(`Category "${category.slug}" failed:`, categoryError)
      summary[category.slug] = `failed: ${String(categoryError)}`
    }
  }

  return new Response(JSON.stringify({ date: collectedDate, summary }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
