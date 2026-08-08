// supabase/functions/collect-headlines/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { CATEGORIES } from './lib/categories.ts'
import {
  cursorIsBefore,
  extractHeadlines,
  extractListCursor,
  extractTemplateListHtml,
  type ScrapedHeadline,
} from './lib/headlines.ts'
import { extractNouns, filterNouns } from './lib/nouns.ts'
import { DEFAULT_COLLECT_CAP, resolveCollectCap } from './lib/collectCap.ts'
// The node entry, which is the one the probe in Task 1 proved: `Garu.load()`
// reads the wasm and the 1.4MB model off disk through fs/promises, and npm
// packages sit on disk under Deno, so it simply works. The browser entry and
// the raw wasm-bindgen glue both need subpaths this package's `exports` map
// does not define, so neither is a fallback — they cannot resolve at all.
import { Garu } from 'npm:garu-ko@0.9.12'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// **The per-section cap is `scoring_weights.collect_cap` and no longer lives
// here.** It was a literal, and migration 0023 moved it because two things have
// to agree about it — this function, which enforces it, and the reporting that
// says whether a section hit it. The read is at the top of Deno.serve.
//
// **CPU is no longer the reason not to page deeper. It was tested and it fits.**
// The refusal that used to stand here — 300 over 12 pages returned 546
// WORKER_RESOURCE_LIMIT once — was diagnosed twice and wrong both times: first
// as a wall-clock wall near 63s, then as this function's own CPU cost. Measured
// on 2026-08-04 with a throwaway probe that scrapes and analyses exactly as this
// file does and writes nothing:
//
//   cap 150 →   900 headlines, 816ms of analysis, 2.0s wall → 200
//   cap 300 → 1,800 headlines, 1,481ms of analysis, 4.2s wall → 200
//   cap 441 → 2,630 headlines, 2,082ms of analysis, 5.3s wall → 200
//
// That is the **all-new** case, the one a live run cannot be made to take on
// demand, and 441 per section is past anything anyone has proposed.
//
// **The 546s are per worker and cumulative, not per request**, which is what
// every earlier reading of them missed. The same cap-441 call that returns 200
// on a fresh worker returns 546 as the third call in a row on a warm one, and
// the ladder in the 2026-08-04 analyser probe (reps=1 → 200, reps=2,3,5,7,10,40
// → 546, in that order and not in order of work) is the same artefact: once a
// worker's budget is spent every later request in it dies whatever its size.
// By the same logic a cron two hours apart should never share a worker — but
// that is reasoning about the schedule, not a measurement: nothing here
// observed how long a worker survives, only that rapid repeated invocation
// trips this. **A collect-now button has to expect a 546 that says nothing
// about the run it killed.**
//
// **What used to stop a raise was the date stamp. That is what the day-boundary
// stop in fetchSectionHeadlines is, and it is why the cap can now move.**
//
// The problem it removes: `collected_date` is the day of collection, a deeper
// page is an older article, so a window wider than the day's own news files
// yesterday under today. It is not a hypothetical cost of raising the cap — it
// was **already happening at 150**, and by more than anyone had counted. Every
// row stored under 2026-08-05 was classified against the live section lists at
// 12:30 KST that day, after three runs: 1,224 rows, of which **129 were
// published before that day** and a further 88 sat deeper than a 1,620-article
// scrape could reach, so almost certainly older still. **80 of the 129 came
// from the 03:00 run**, which is exactly where this was predicted to be worst
// and exactly the run nobody had measured.
//
// **The 03:00 and 07:00 regime is measurable without waiting for it**, which is
// what makes the above a measurement rather than an estimate. The list is
// ordered by publication time, so "articles published between midnight and T"
// is the rank at which a run starting at T crosses into yesterday. Counted at
// 12:30 KST on 2026-08-05:
//
//   section    published by 03:00   by 07:00
//   politics                   17         50
//   economy                    24        120
//   society                    42        136
//   culture                    15         52
//   world                      15         75
//   it                          1         23
//
// **Not one section reaches 150 before 07:00.** At 03:00 a 150-headline window
// spends 133 of its 150 slots on yesterday in politics and 149 in it. What kept
// the damage down to 129 rows is only that most of those articles were already
// held: `UNIQUE (category_id, link)` is global rather than per-date, so a
// yesterday article yesterday collected cannot be re-stamped. The 129 are the
// ones that fell in a coverage hole.
//
// **The other end of the day says the opposite thing about the same number, and
// that is the finding.** Of the articles published on 2026-08-05 before the
// 11:00 run, **42.9% were never collected at all** — 704 of 1,641, and 61% of
// economy, 53% of society. Every one of those holes sits between 07:00 and
// 11:00, and none at all between midnight and 05:00. So a 150 window is
// simultaneously far too wide for the thin hours and less than half of what the
// busy ones need, and **the boundary stop is what lets one number stop being
// asked to do both**: in the thin hours it stops the scrape early, in the busy
// hours it never fires, so the cap is free to rise for the case that wants it.
//
// What the 11:00 run of that day would newly have stored, boundary stop on:
//
//   cap        150   200   300   450   600
//   new rows   126   228   426   680   704
//
// **300 is the recommendation and it is not the top of that column**, because
// 450 puts a cold all-new run at ~2,700 headlines against the 2,630 that is the
// deepest anything here has been measured at, and the worker budget is
// cumulative. Raise to 300, read `off-day` and the section counts for a day,
// then decide about 450. The cap is a `scoring_weights` value: no redeploy.
//
// **The one thing lost is real and small.** Those 129 rows a day are genuine
// articles, and after this change they are not collected at all rather than
// collected under the wrong date. That is the right trade — they are yesterday's
// holes, and 426 correctly dated rows arrive in their place — but it is a trade
// and not a free fix. Deciding instead to stamp rows by publication date would
// keep them, at the cost of a past day's totals changing after it closed, which
// invalidates every measurement taken against that day. Not done.
//
// Note also that deeper paging **widens the section gap rather than closing
// it**: the recovery above is 359 economy and 285 society against 11 culture,
// 9 world and 11 it. Balance is a ranking question, and round fourteen's
// `df_balanced` is where it lives.
//
// Why more headlines are wanted at all is settled elsewhere and is not the
// `min_headlines` argument this comment used to make: round seven of
// scripts/analysis/README.md found that on a fat day the word at rank 70 already
// has eight headlines, so a promotion floor is unnecessary rather than deferred.
// What a thicker day buys is a deeper pool for the render cap to pick 70 from,
// and Task 7 measured that the top 70 of a bigger pool is a better 70 — 95.7%
// good against 68.8% for ranks 71 and below.
//
// The reason to prefer running more often is unaffected and is about freshness
// rather than cost: **a deeper page is older news, a later run is newer news.**
// Measured on 2026-08-03, one manual run some hours after the 07:00 cron found
// 404 new headlines inside the same 150-per-section window. There are **twelve**
// cron jobs — 03 KST, every two hours from 05 to 23, and one at 23:50 — all
// calling this same function. The 23:50 one exists because the next run after
// 23:00 is 03:00 *tomorrow*, so the day-boundary stop below was dropping every
// article published in the last hour of the day: ~100 a day, permanently. See
// this function's README for the per-run and per-hour tables.
//
// There is no external call limit any more — the analyser is in-process — so
// nothing outside this function constrains how often or how deep it runs.
// MAX_LIST_PAGES is slack behind the cap, never a second cap. A section's first
// page carries 44-46 headlines and each "더보기" page adds exactly 36, so 8 pages
// stop at ~298 — which is a limit the operator did not choose and cannot see,
// since it fires as a short scrape rather than as anything named. 12 pages reach
// ~440, past any cap this function has been measured at. Nothing else reads it.
const MAX_LIST_PAGES = 12

// **What the next version of this file is for.**
//
// The cap raise this list used to head is **done** — `collect_cap` went to 300
// on 2026-08-07, and the before/after inside that day is in the README: 141 of
// 1,821 rows mis-dated under the old code against 0 of 937 after. Two left:
//
// 1. **A collect-now button** in the frontend, so a collection can be taken on
//    demand instead of waiting for the next cron. Note the worker budget is
//    cumulative: pressing it repeatedly is exactly the shape that returns 546
//    with no body. Twelve runs a day has made this less pressing than it was at
//    six — the longest wait is now two hours rather than four.
// 2. **Filter duplicate headlines by title.** `UNIQUE (category_id, link)` plus
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

/**
 * Walks the section's paginated list until the day boundary is crossed, the cap
 * is reached, the pages run out, or a page fails. A short page set is not an
 * error: partial collection beats losing the whole category, and the next run
 * re-scrapes anyway.
 *
 * **Nothing published on another day is returned**, and that is what makes the
 * cap raisable. Two mechanisms, because one cannot do it:
 *
 * - **`published !== collectedDate` drops the article**, wherever it sits. The
 *   first page is not in publication order — it opens with the curated headline
 *   block — so a rule that stopped at the first old article would truncate it
 *   at whatever rank the editor put an old story.
 * - **`cursorIsBefore` stops the paging.** Once a page's oldest article
 *   predates the day, the next page holds nothing but the day before, and there
 *   is no reason to fetch it.
 *
 * An article whose date cannot be read is **kept**, the same fail-open choice
 * `canonicalLink` makes: dropping it would lose real news over a markup change,
 * while keeping it costs one mis-dated row — the outcome every row used to get.
 */
async function fetchSectionHeadlines(
  sectionId: string,
  cap: number,
  collectedDate: string,
): Promise<{ headlines: ScrapedHeadline[]; dropped: number }> {
  const collected: ScrapedHeadline[] = []
  const seenLinks = new Set<string>()
  let dropped = 0

  const absorb = (batch: ScrapedHeadline[]) => {
    for (const headline of batch) {
      if (seenLinks.has(headline.link)) continue
      seenLinks.add(headline.link)
      if (headline.published !== null && headline.published !== collectedDate) {
        dropped += 1
        continue
      }
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

  for (
    let page = 2;
    page <= MAX_LIST_PAGES &&
    collected.length < cap &&
    cursor?.hasNext &&
    !cursorIsBefore(cursor, collectedDate);
    page++
  ) {
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

  return { headlines: collected.slice(0, cap), dropped }
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

  // One read, before the loop, so every category in a run scrapes to the same
  // depth — reading it per category would let a mid-run edit split the run.
  // A failed read is a fallback rather than an abort: see lib/collectCap.ts for
  // why the coercion is a function and not `Number(value ?? 150)`.
  //
  // The request itself is also wrapped, not just its `error` field. postgrest-js
  // resolves an ordinary failed fetch into `{ data: null, error }` rather than
  // rejecting, which the `capError` check below already covers — but a thrown
  // rejection (a network error the client itself raises, a client bug) is not
  // that shape, and an unguarded `await` would abort the handler before the
  // category loop instead of falling back, which is exactly the "a failed read
  // silently collects nothing" case the default exists to prevent.
  let capRow: { value: unknown } | null = null
  try {
    const { data, error: capError } = await supabase
      .from('scoring_weights')
      .select('value')
      .eq('key', 'collect_cap')
      .maybeSingle()
    if (capError) console.error('collect_cap read failed, using the default:', capError)
    else capRow = data
  } catch (capThrow) {
    console.error('collect_cap read threw, using the default:', capThrow)
  }
  const headlineCap = resolveCollectCap(capRow?.value)
  if (headlineCap === DEFAULT_COLLECT_CAP && capRow?.value == null) {
    console.error(`CHK collect_cap unreadable — falling back to ${DEFAULT_COLLECT_CAP}`)
  } else if (capRow?.value != null && headlineCap !== Number(capRow.value)) {
    // The row exists and holds something, but not a shape resolveCollectCap can
    // use — 'many', 0, a negative number, an object. The branch above only ever
    // caught a missing row or a null value, so this is the only signal an
    // operator gets when an `update` did not take the shape it needed to.
    console.error(
      `CHK collect_cap unusable (${JSON.stringify(capRow.value)}) — falling back to ${headlineCap}`,
    )
  }

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
      const { headlines, dropped } = await fetchSectionHeadlines(
        category.sectionId,
        headlineCap,
        collectedDate,
      )
      console.log(
        `CHK ${category.slug} scraped ${headlines.length} (${dropped} off-day) in ` +
          `${Date.now() - scrapeStart}ms (run ${Date.now() - startedAt}ms)`,
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
      // The two phase timings are in the body as well as in the CHK lines
      // because the CHK lines are only reachable from the dashboard — the
      // Management API's log endpoint refuses them — and the split between
      // scraping and processing is the only thing that says which half of a run
      // is approaching the CPU budget. It costs about 20 characters a category.
      // `off-day` is the count the day-boundary stop is judged on, and it has to
      // be in the body for the same reason the phase timings are: the CHK lines
      // are dashboard-only. A run that reports 0 off-day on every section either
      // never reached the boundary or has stopped reading the date.
      summary[category.slug] =
        `ok: ${headlines.length} collected, ${dropped} off-day, ${tally.processed} processed, ` +
        `${tally.stored} new, ${tally.repaired} repaired, ${tally.failed} noun rows failed ` +
        `(scrape ${processStart - scrapeStart}ms, process ${Date.now() - processStart}ms)`
    } catch (categoryError) {
      console.error(`Category "${category.slug}" failed:`, categoryError)
      summary[category.slug] = `failed: ${String(categoryError)}`
    }
  }

  // 검색이 읽는 사전은 미리 지어 둬야 의미가 있다 — 부분일치는 어떤 인덱스도 타지
  // 않아서, 명사 행 11만 개를 그때그때 훑으면 316ms이고 그 값은 헤드라인 수에
  // 비례해 자란다. 여기서 갱신하면 검색은 항상 직전 런까지 최신이다.
  //
  // **실패는 삼킨다.** 사전이 하루 낡는 것과 수집이 실패하는 것은 비교 대상이
  // 아니다. 대신 응답 본문에 적는다: `CHK` 로그는 대시보드에만 있고 Management
  // API는 function_logs에 403을 주므로, 기계가 읽을 수 있는 유일한 자리가 본문이다.
  //
  // CPU 예산과는 무관하다. 이 함수를 죽이는 한계는 워커의 **누적 CPU**인데 이것은
  // DB가 하는 일을 기다리는 벽시계 시간이다.
  let directory = 'ok'
  try {
    const { error: refreshError } = await supabase.rpc('refresh_word_directory')
    if (refreshError) {
      directory = `failed: ${refreshError.message}`
      console.error('CHK word_directory refresh failed:', refreshError)
    }
  } catch (refreshThrow) {
    // postgrest-js resolves an ordinary failure into { error }, but a network
    // error it raises itself is not that shape — and an unguarded await here
    // would lose the whole run's summary at the very last step.
    directory = `failed: ${String(refreshThrow)}`
    console.error('CHK word_directory refresh threw:', refreshThrow)
  }

  // keyword_graph_cache (migration 0032) holds one precomputed row per
  // (collected_date, category_slug); the RPC anon actually calls now just
  // reads it, falling back to the ~2s recompute only on a miss. Today's date
  // is the one date that always misses the moment this run starts, so it has
  // to be filled here or the day's first several page loads pay the full
  // cost the cache exists to remove — and worse, five of them at once would
  // each hit anon's 3s statement_timeout, which is the failure this migration
  // was written to fix.
  //
  // Same shape as the word_directory refresh just above: swallow the failure
  // (a stale cache serving yesterday's thresholds is a far smaller fault than
  // a collection run reported as failed), guard both the postgrest `{ error }`
  // shape and a thrown rejection, and report the outcome in the body — the
  // only machine-readable channel out of this function.
  //
  // **0033: refresh_stale_keyword_graph_cache, not refresh_keyword_graph_cache
  // directly.** That swallowed failure means a bad refresh used to leave a
  // date's cache stale with no further consequence — the graphCache field
  // nobody reads was the only signal. This heals it instead: today is still
  // refreshed unconditionally, and up to one more date the
  // keyword_graph_cache_health view calls stale or missing (newest first) is
  // refreshed alongside it, so a failed run's cache recovers within a bounded
  // number of later runs rather than staying broken until an operator happens
  // to read the body. See migration 0033's header for the ~28s-per-run /
  // 8-day-backlog-in-2-days arithmetic behind the `1`.
  //
  // This is wall clock the worker waits on the database for, not worker CPU —
  // the same distinction the run-budget section of CLAUDE.md draws about the
  // old ETRI wait — so it does not threaten the CPU budget that actually kills
  // this function. It does add real wall time, though: up to 2 dates x 7
  // cells at ~2s each is ~28s, on top of the ~300ms word_directory refresh.
  // `RUN_BUDGET_MS` (50_000) only bounds the category loop above, not this
  // tail, and the category loop's own slack (a full 900-headline run finishes
  // in 4-5s against a 50s budget) is what leaves room for it.
  let graphCache = 'ok'
  try {
    const { data: refreshedDates, error: graphCacheError } = await supabase.rpc(
      'refresh_stale_keyword_graph_cache',
      { p_today: collectedDate, p_extra: 1 },
    )
    if (graphCacheError) {
      graphCache = `failed: ${graphCacheError.message}`
      console.error('CHK keyword_graph_cache refresh failed:', graphCacheError)
    } else {
      graphCache = `ok: refreshed ${(refreshedDates ?? []).join(', ')}`
    }
  } catch (graphCacheThrow) {
    graphCache = `failed: ${String(graphCacheThrow)}`
    console.error('CHK keyword_graph_cache refresh threw:', graphCacheThrow)
  }

  return new Response(
    // `cap` is in the response because it is now a database value: without it
    // the summary cannot be read without a second query asking what the run was
    // configured with, and a run's own report should say what it ran with.
    JSON.stringify({
      date: collectedDate,
      cap: headlineCap,
      elapsedMs: Date.now() - startedAt,
      directory,
      graphCache,
      summary,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
