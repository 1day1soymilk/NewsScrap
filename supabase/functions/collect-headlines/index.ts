// supabase/functions/collect-headlines/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CATEGORIES } from './lib/categories.ts'
import { extractHeadlines } from './lib/headlines.ts'
import { callEtriMorphAnalysis, extractNouns, filterNouns } from './lib/nouns.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ETRI_API_KEY = Deno.env.get('ETRI_API_KEY')!

function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
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

      let storedCount = 0
      for (const headline of headlines) {
        const { data: inserted, error: insertError } = await supabase
          .from('headlines')
          .upsert(
            {
              category_id: categoryRow.id,
              title: headline.title,
              link: headline.link,
              collected_date: collectedDate,
            },
            { onConflict: 'category_id,link', ignoreDuplicates: true },
          )
          .select('id')

        if (insertError) {
          console.error(`Failed to store headline "${headline.link}":`, insertError)
          continue
        }
        if (!inserted || inserted.length === 0) {
          continue // already collected earlier today
        }
        const headlineId = inserted[0].id
        storedCount += 1

        try {
          const etriResponse = await callEtriMorphAnalysis(headline.title, ETRI_API_KEY)
          const nouns = filterNouns(extractNouns(etriResponse))
          if (nouns.length > 0) {
            const { error: nounsError } = await supabase
              .from('headline_nouns')
              .insert(nouns.map((word) => ({ headline_id: headlineId, word })))
            if (nounsError) {
              console.error(`Failed to store nouns for headline ${headlineId}:`, nounsError)
            }
          }
        } catch (etriError) {
          console.error(`ETRI analysis failed for headline ${headlineId}:`, etriError)
        }
      }

      summary[category.slug] = `ok: ${headlines.length} seen, ${storedCount} new`
    } catch (categoryError) {
      console.error(`Category "${category.slug}" failed:`, categoryError)
      summary[category.slug] = `failed: ${String(categoryError)}`
    }
  }

  return new Response(JSON.stringify({ date: collectedDate, summary }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
