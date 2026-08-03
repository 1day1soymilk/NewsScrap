// supabase/functions/collect-headlines/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { CATEGORIES } from './lib/categories.ts'
import {
  extractHeadlines,
  extractListCursor,
  extractTemplateListHtml,
  type ScrapedHeadline,
} from './lib/headlines.ts'
import { callEtriMorphAnalysis, extractNouns, filterNouns } from './lib/nouns.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ETRI_API_KEY = Deno.env.get('ETRI_API_KEY')!

// A section's first page carries ~45 headlines and each "더보기" page adds ~36,
// so this cap is reached in four pages (measured across all six sections).
// MAX_LIST_PAGES is slack for a section whose pages come back short.
//
// **Raising this is the wrong way to collect more, and it was tried.** 300 over
// 12 pages killed the run: status 546, WORKER_RESOURCE_LIMIT, at 63s, against a
// successful 150-page run of 64.6s the same morning. The wall on this plan is
// near 63s and not the 150s the docs quote, so a bigger cap does not buy a
// bigger run — it buys a run that returns nothing.
//
// The way to collect more is **to run more often**, and it is better on its own
// terms. A deeper page is older news; a later run is newer news. Measured on
// 2026-08-03, one manual run some hours after the 07:00 cron found **404 new
// headlines inside this same 150-per-section window** — the sections churn
// through the day. There are now four cron jobs (07, 11, 15, 19 KST) rather
// than one, all calling this same function.
//
// Why more headlines are wanted at all: `min_headlines` is the floor under
// which a word is noise, and at ~900 a day raising it from 3 to 4 leaves only
// 51 to 71 words eligible, so three of the four archived days can no longer
// fill the 70 places on the canvas. Measured, that floor costs 8.1 mean F1
// (67.30 to 59.20) with precision flat and recall collapsing — rule 5 in
// scripts/analysis/README.md exactly. **The floor is not wrong, the corpus is
// thin.** A word needs four headlines to be worth drawing whether the day holds
// 900 or 1,800; what changes is how many words clear it.
//
// ETRI allows 5,000 calls a day and a duplicate costs none, so four runs at a
// few hundred new headlines each sit comfortably inside it.
const MAX_HEADLINES_PER_CATEGORY = 150
const MAX_LIST_PAGES = 8

// Every headline costs one ETRI round trip (~0.5s) plus two or three DB calls,
// all of it I/O wait, so the CPU-time limit (2s) is never the binding one.
// Sequentially, 900 headlines would take ~12 minutes against a wall-clock
// budget of 150s (free plan) / 400s (paid). At 8 in flight it lands near 90s.
const ANALYSIS_CONCURRENCY = 8

// Stop handing out new work here so the function returns its summary instead of
// being killed mid-flight. Anything left over is picked up by the next run,
// since duplicates skip ETRI entirely.
//
// **This was 110_000 and that number was never real.** The platform returned
// 546 WORKER_RESOURCE_LIMIT at 63s on a heavier run, while a successful run the
// same morning took 64.6s — so the wall is around 63s and this budget never
// once fired. It now sits below the wall, which is the whole point of having
// it: a killed run reports nothing, and the summary is the only way index.ts is
// checked at all (it is not type-checked and not unit-tested).
//
// Raise toward 360_000 on a paid plan, but measure the wall first rather than
// trusting the documented limit.
const RUN_BUDGET_MS = 50_000

function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

// Walks the section's paginated list until the cap is reached, the pages run
// out, or a page fails. A short page set is not an error: partial collection
// beats losing the whole category, and the next run re-scrapes anyway.
async function fetchSectionHeadlines(sectionId: string, cap: number): Promise<ScrapedHeadline[]> {
  const collected: ScrapedHeadline[] = []
  const seenLinks = new Set<string>()

  const absorb = (batch: ScrapedHeadline[]) => {
    for (const headline of batch) {
      if (seenLinks.has(headline.link)) continue
      seenLinks.add(headline.link)
      collected.push(headline)
    }
  }

  const sectionUrl = `https://news.naver.com/section/${sectionId}`
  const firstResponse = await fetch(sectionUrl)
  if (!firstResponse.ok) {
    throw new Error(`section fetch failed with status ${firstResponse.status}`)
  }
  const firstHtml = await firstResponse.text()
  absorb(extractHeadlines(firstHtml))
  let cursor = extractListCursor(firstHtml)

  for (let page = 2; page <= MAX_LIST_PAGES && collected.length < cap && cursor?.hasNext; page++) {
    const listUrl =
      `https://news.naver.com/section/template/SECTION_ARTICLE_LIST` +
      `?sid=${sectionId}&sid2=&cluid=&pageNo=${cursor.pageNo}&date=&next=${cursor.cursor}` +
      `&_=${Date.now()}`

    const listResponse = await fetch(listUrl, { headers: { Referer: sectionUrl } })
    if (!listResponse.ok) {
      console.error(`section ${sectionId} page ${page} failed with status ${listResponse.status}`)
      break
    }

    const listHtml = extractTemplateListHtml(await listResponse.json())
    const batch = extractHeadlines(listHtml)
    if (batch.length === 0) break

    absorb(batch)
    cursor = extractListCursor(listHtml)
  }

  return collected.slice(0, cap)
}

interface CategoryTally {
  stored: number
  repaired: number
  failed: number
  processed: number
}

// Pulls from a shared cursor so a slow headline never blocks the others, and
// re-checks the deadline before each item rather than after the batch.
async function processHeadlines(
  supabase: SupabaseClient,
  headlines: ScrapedHeadline[],
  categoryId: string,
  collectedDate: string,
  deadline: number,
): Promise<CategoryTally> {
  const tally: CategoryTally = { stored: 0, repaired: 0, failed: 0, processed: 0 }
  let next = 0

  const worker = async () => {
    while (true) {
      if (Date.now() >= deadline) return
      const index = next++
      if (index >= headlines.length) return
      const headline = headlines[index]
      tally.processed += 1

      try {
        const outcome = await storeHeadline(supabase, headline, categoryId, collectedDate)
        if (outcome === 'stored') tally.stored += 1
        else if (outcome === 'repaired') tally.repaired += 1
      } catch (headlineError) {
        tally.failed += 1
        console.error(`Failed to process headline "${headline.link}":`, headlineError)
      }
    }
  }

  await Promise.all(Array.from({ length: ANALYSIS_CONCURRENCY }, worker))
  return tally
}

async function storeHeadline(
  supabase: SupabaseClient,
  headline: ScrapedHeadline,
  categoryId: string,
  collectedDate: string,
): Promise<'stored' | 'repaired' | 'skipped'> {
  const { data: existing, error: lookupError } = await supabase
    .from('headlines')
    .select('id')
    .eq('category_id', categoryId)
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
    if ((count ?? 0) > 0) return 'skipped'

    const nouns = await analyseNouns(headline.title)
    if (nouns.length === 0) return 'skipped'

    const { error: backfillError } = await supabase
      .from('headline_nouns')
      .insert(nouns.map((word) => ({ headline_id: existing.id, word })))
    if (backfillError) throw backfillError
    return 'repaired'
  }

  // Nouns first: if ETRI fails or yields nothing usable we leave no row
  // behind, so the next run re-scrapes this link and retries naturally.
  const nouns = await analyseNouns(headline.title)
  if (nouns.length === 0) return 'skipped'

  const { data: inserted, error: insertError } = await supabase
    .from('headlines')
    .insert({
      category_id: categoryId,
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
  return 'stored'
}

async function analyseNouns(title: string): Promise<string[]> {
  return filterNouns(extractNouns(await callEtriMorphAnalysis(title, ETRI_API_KEY)))
}

Deno.serve(async () => {
  const startedAt = Date.now()
  const deadline = startedAt + RUN_BUDGET_MS
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const collectedDate = todayInSeoul()
  const summary: Record<string, string> = {}

  // Each category gets its own slice of the budget rather than racing for one
  // shared deadline. With a single deadline the categories at the end of the
  // list would be the ones starved on every slow run, and always the same ones.
  const sliceMs = RUN_BUDGET_MS / CATEGORIES.length

  for (const [index, category] of CATEGORIES.entries()) {
    const sliceDeadline = Math.min(startedAt + sliceMs * (index + 1), deadline)
    if (Date.now() >= sliceDeadline) {
      summary[category.slug] = 'skipped: run budget exhausted'
      continue
    }

    try {
      const { data: categoryRow, error: categoryError } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', category.slug)
        .single()

      if (categoryError || !categoryRow) {
        throw new Error(`category "${category.slug}" not found in DB — did the migration run?`)
      }

      const headlines = await fetchSectionHeadlines(
        category.sectionId,
        MAX_HEADLINES_PER_CATEGORY,
      )
      const tally = await processHeadlines(
        supabase,
        headlines,
        categoryRow.id,
        collectedDate,
        sliceDeadline,
      )

      summary[category.slug] =
        `ok: ${headlines.length} collected, ${tally.processed} processed, ` +
        `${tally.stored} new, ${tally.repaired} repaired, ${tally.failed} failed`
    } catch (categoryError) {
      console.error(`Category "${category.slug}" failed:`, categoryError)
      summary[category.slug] = `failed: ${String(categoryError)}`
    }
  }

  return new Response(
    JSON.stringify({ date: collectedDate, elapsedMs: Date.now() - startedAt, summary }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
