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
import { extractNouns, filterNouns } from './lib/nouns.ts'
// The node entry, which is the one the probe in Task 1 proved: `Garu.load()`
// reads the wasm and the 1.4MB model off disk through fs/promises, and npm
// packages sit on disk under Deno, so it simply works. The browser entry and
// the raw wasm-bindgen glue both need subpaths this package's `exports` map
// does not define, so neither is a fallback — they cannot resolve at all.
import { Garu } from 'npm:garu-ko@0.9.12'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// A section's first page carries ~45 headlines and each "더보기" page adds ~36,
// so this cap is reached in four pages (measured across all six sections).
// MAX_LIST_PAGES is slack for a section whose pages come back short.
//
// **The measurement that set this needs re-testing, and it is now known to have
// measured the wrong thing.** 300 over 12 pages killed the run — 546
// WORKER_RESOURCE_LIMIT at 63s, against a successful 150-per-section run of
// 64.6s the same morning — and that was read as a wall-clock wall near 63s.
// It is not. The platform kills on **CPU time**, roughly 3s of it per worker,
// and it says so: `CPU Time exceeded` in the function logs. The 63s run died
// because it was doing 5,400 ETRI-paced round trips, not because 63 seconds
// had passed; a 64.6s run passed the same morning on fewer of them.
//
// Since storage was batched (see processHeadlines) a full 900-headline run
// costs 4-5s of wall clock and a small fraction of the CPU budget, so **deeper
// paging may now fit and nobody has tried.** Measure `elapsedMs` and watch for
// `CPU Time exceeded` rather than trusting either number above.
//
// Note that the reason to prefer running more often is unaffected, because it
// is about freshness rather than cost: **a deeper page is older news, a later
// run is newer news.**
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
// There is no external call limit any more — the analyser is in-process — so
// nothing outside this function constrains how often or how deep it runs.
const MAX_HEADLINES_PER_CATEGORY = 150
const MAX_LIST_PAGES = 8

// **What the next version of this file is for**, written down because all three
// of the numbers around here lost their justification on the same day:
//
// 1. **Re-tune collection volume** — the cap and the page count, each measured
//    on its own, against the CPU budget rather than the wall clock.
// 2. **A collect-now button** in the frontend, so a collection can be taken on
//    demand instead of waiting for the next of six crons.
// 3. **Filter duplicate headlines by title.** `UNIQUE (category_id, link)` plus
//    `canonicalLink` stop one article arriving twice, but the same story from a
//    different outlet is not caught — 2026-08-01 holds 190 such rows.
//    Duplicates inflate co-occurrence, so `edge_min_cooc = 2` can be satisfied
//    by a single story collected twice.

// **ANALYSIS_CONCURRENCY is gone rather than left unreasoned.** Eight in flight
// existed because every headline waited ~500ms on ETRI and the pool was what
// hid that wait. Analysis is now in-process, and storage is batched per
// category, so a category is five or six sequential requests — there is no wait
// left for a pool to overlap and nothing for the constant to mean. Its comment
// claimed "the CPU-time limit is never the binding one", which was true only
// because of the wait it was compensating for; the CPU limit is now the only
// binding one. See processHeadlines.

// Stop handing out new work here so the function returns its summary instead of
// being killed mid-flight. Anything left over is picked up by the next run,
// since a duplicate costs one batched lookup and no analysis.
//
// **This budget has lost its reason, and worse, it never guarded the thing that
// actually kills the run.** It was 110_000 and never fired; it was lowered to
// 50_000 on the belief that the platform's wall was ~63s of wall clock. It is
// not. The kill is on **CPU time** — the logs say `CPU Time exceeded` — at
// roughly 3s per worker, and a wall-clock budget cannot see that number at all.
// A 45s run died while a 64.6s one passed, which is the shape of a limit that
// is not about elapsed time.
//
// What keeps the function inside the CPU budget is the batching in
// processHeadlines, not this constant. A full 900-headline run now finishes in
// 4-5s, so 50_000 is ten times slack and fires never — the same state it was in
// at 110_000. It stays because a scrape that hangs on Naver still needs some
// stop, and because the per-category slice keeps a slow section from starving
// the ones after it. **It may be able to go away entirely.** Check `elapsedMs`
// in the response before touching it, and note that raising it buys nothing
// against the limit that does the killing.
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

// Links per lookup request. The links go into the query string, so this is
// bounded by URL length rather than by anything about Postgres — 50 of them is
// about 2.5kB.
const LOOKUP_CHUNK = 50
// Rows per write. A category yields at most 150 headlines and around 1,000
// noun rows, so this is two or three requests rather than one per row.
const INSERT_CHUNK = 500

/**
 * Stores a category's scrape in a handful of requests rather than three per
 * headline.
 *
 * **The per-headline shape is what killed this function**, and not for the
 * reason it looks like. Analysis is 0.88ms and the whole day's 900 headlines
 * cost 0.8s of CPU — measured on the platform, with the heap flat at 9MB. What
 * exceeded the worker's CPU budget was the ~2,700 round trips around it: with
 * ETRI every one of them sat behind a 500ms wait, so the worker was idle
 * ~98% of a 64s run and its cumulative CPU stayed small. Removing the wait did
 * not add CPU, it removed the idling, and the platform kills on **CPU time**,
 * not on the wall clock — a 45s run died where a 64.6s one had passed.
 *
 * So the batching is not an optimisation bolted onto the analyser swap. It is
 * what the swap requires: the round trip had been paying for the request count
 * all along.
 */
async function processHeadlines(
  supabase: SupabaseClient,
  garu: Garu,
  headlines: ScrapedHeadline[],
  categoryId: string,
  collectedDate: string,
  deadline: number,
): Promise<CategoryTally> {
  const tally: CategoryTally = { stored: 0, repaired: 0, failed: 0, processed: 0 }

  // The embedded count answers "does this link already have nouns" in the same
  // round trip that answers "does this link exist", which is what the lookup
  // and the count used to cost separately, per headline.
  const existing = new Map<string, { id: string; nouns: number }>()
  for (let index = 0; index < headlines.length; index += LOOKUP_CHUNK) {
    if (Date.now() >= deadline) return tally
    const chunk = headlines.slice(index, index + LOOKUP_CHUNK)
    const { data, error } = await supabase
      .from('headlines')
      .select('id, link, headline_nouns(count)')
      .eq('category_id', categoryId)
      .in('link', chunk.map((headline) => headline.link))
    if (error) throw error
    for (const row of data ?? []) {
      existing.set(row.link, { id: row.id, nouns: row.headline_nouns?.[0]?.count ?? 0 })
    }
  }

  // Everything is analysed before anything is written, so a headline is still
  // never inserted without its nouns in hand — the rule the ETRI version stated
  // as "nouns first". A row with no nouns at all is a word cloud that cannot
  // see the headline, which is why the repair below exists as well.
  type Noun = { word: string; pos: string }
  const fresh: { headline: ScrapedHeadline; nouns: Noun[] }[] = []
  const repairs: { id: string; nouns: Noun[] }[] = []
  for (const headline of headlines) {
    tally.processed += 1
    const seen = existing.get(headline.link)
    if (seen && seen.nouns > 0) continue
    const nouns = analyseNouns(garu, headline.title)
    if (nouns.length === 0) continue
    if (seen) repairs.push({ id: seen.id, nouns })
    else fresh.push({ headline, nouns })
  }

  const nounRows: { headline_id: string; word: string; pos: string }[] = repairs.flatMap(
    ({ id, nouns }) => nouns.map((noun) => ({ headline_id: id, word: noun.word, pos: noun.pos })),
  )
  tally.repaired = repairs.length

  // Upsert rather than insert so an overlapping cron cannot turn a duplicate
  // into a failed batch. ON CONFLICT DO NOTHING returns only the rows actually
  // inserted, which is exactly the set whose nouns this run owns — a row the
  // other run inserted is that run's to fill in, and the repair path above
  // catches it either way.
  for (let index = 0; index < fresh.length; index += INSERT_CHUNK) {
    if (Date.now() >= deadline) break
    const chunk = fresh.slice(index, index + INSERT_CHUNK)
    const { data, error } = await supabase
      .from('headlines')
      .upsert(
        chunk.map(({ headline }) => ({
          category_id: categoryId,
          title: headline.title,
          link: headline.link,
          collected_date: collectedDate,
        })),
        { onConflict: 'category_id,link', ignoreDuplicates: true },
      )
      .select('id, link')
    if (error) throw error

    const nounsByLink = new Map(chunk.map(({ headline, nouns }) => [headline.link, nouns]))
    for (const row of data ?? []) {
      for (const noun of nounsByLink.get(row.link) ?? []) {
        nounRows.push({ headline_id: row.id, word: noun.word, pos: noun.pos })
      }
      tally.stored += 1
    }
  }

  // A failed chunk is logged and counted rather than thrown, because the
  // headlines are already in: throwing would lose the category's whole scrape
  // over rows the next run repairs anyway.
  for (let index = 0; index < nounRows.length; index += INSERT_CHUNK) {
    const chunk = nounRows.slice(index, index + INSERT_CHUNK)
    const { error } = await supabase.from('headline_nouns').insert(chunk)
    if (error) {
      tally.failed += chunk.length
      console.error(`noun insert of ${chunk.length} rows failed:`, error)
    }
  }

  return tally
}

// The analyser is loaded once per invocation and reused for every headline in
// the run. Loading is the expensive part — a 1.4MB model and the WASM — and
// analysis itself is 0.79ms a headline, measured over 2,197 real ones.
let analyser: Garu | null = null
async function loadAnalyser(): Promise<Garu> {
  if (!analyser) analyser = await Garu.load()
  return analyser
}

function analyseNouns(garu: Garu, title: string) {
  const normalised = title.normalize('NFC')
  const tokens = garu.analyze(normalised).tokens
  return filterNouns(extractNouns(normalised, tokens))
}

Deno.serve(async () => {
  const startedAt = Date.now()
  const deadline = startedAt + RUN_BUDGET_MS
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const garu = await loadAnalyser()
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

      const scrapeStart = Date.now()
      const headlines = await fetchSectionHeadlines(
        category.sectionId,
        MAX_HEADLINES_PER_CATEGORY,
      )
      console.log(
        `CHK ${category.slug} scraped ${headlines.length} in ${Date.now() - scrapeStart}ms ` +
          `(run ${Date.now() - startedAt}ms)`,
      )
      const processStart = Date.now()
      const tally = await processHeadlines(
        supabase,
        garu,
        headlines,
        categoryRow.id,
        collectedDate,
        sliceDeadline,
      )

      console.log(
        `CHK ${category.slug} processed ${tally.processed} in ${Date.now() - processStart}ms ` +
          `(run ${Date.now() - startedAt}ms)`,
      )
      summary[category.slug] =
        `ok: ${headlines.length} collected, ${tally.processed} processed, ` +
        `${tally.stored} new, ${tally.repaired} repaired, ${tally.failed} noun rows failed`
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
