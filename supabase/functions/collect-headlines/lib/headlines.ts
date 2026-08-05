export interface ScrapedHeadline {
  title: string
  link: string
  /**
   * The day the article was published, `YYYY-MM-DD`, or **null when the markup
   * does not say** — which is 0.3% of items, measured over 676 of them across
   * three sections and six pages on 2026-08-05.
   *
   * It is read off the thumbnail's origin path rather than off the visible
   * timestamp beside the headline, and that is a deliberate choice between two
   * available sources. The visible one is relative ("2시간전", "1일전"): it needs
   * the current time and a time zone to become a date, it is hour-grained, and
   * past a day it stops resolving at all — three ways to be wrong about exactly
   * the articles this field exists to identify. The thumbnail path carries the
   * date literally, so reading it is a pure function of the HTML, which is also
   * what keeps this file testable without a clock.
   *
   * Checked against the page cursor before it was relied on: over 30 pages of
   * three sections, **not one article carried a thumbnail date older than its
   * own page's cursor stamp**, and every page whose cursor had crossed midnight
   * held exactly the mixture of the two days that implies.
   */
  published: string | null
}

// sa_text_title may appear anywhere in the class list, not just first.
const ANCHOR_RE = /<a\b([^>]*class="[^"]*\bsa_text_title\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g
const HREF_RE = /href="([^"]+)"/
const STRONG_RE = /<strong[^>]*>([\s\S]*?)<\/strong>/

// Naver serves an article's thumbnail from a path that spells out the day it
// was published: .../image/origin/{press}/2026/08/05/{id}.jpg. The image sits
// inside the same <li> as the headline and **before** it, so the date belonging
// to a headline is the last one appearing above that headline's anchor.
const IMG_DATE_RE = /\/image\/origin\/\d+\/(\d{4})\/(\d{2})\/(\d{2})\//g

// 섹션 첫 페이지는 /mnews/article/{press}/{id}를, "더보기" 페이지네이션은
// /article/{press}/{id}를 같은 기사에 준다. 삽입 시 중복 검사(index.ts)는 링크
// 문자열 전체를 맞춰 보므로, 여기서 합쳐 두지 않으면 같은 기사가 두 행이 된다.
//
// 꼬리에서 재구성하기 때문에 호스트·mnews·쿼리·해시·트레일링 슬래시가 한 번에
// 정리된다. 패턴이 맞지 않으면 원본을 그대로 돌려준다 — 네이버가 URL 모양을
// 바꿨을 때 뭉개면 서로 다른 기사가 한 링크로 합쳐져 조용히 유실된다.
const ARTICLE_PATH_RE = /\/article\/(\d+)\/(\d+)(?:[/?#]|$)/

export function canonicalLink(href: string): string {
  const match = ARTICLE_PATH_RE.exec(href)
  if (!match) return href
  return `https://n.news.naver.com/article/${match[1]}/${match[2]}`
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
}

export function extractHeadlines(html: string): ScrapedHeadline[] {
  const results: ScrapedHeadline[] = []
  const seenLinks = new Set<string>()

  // Both sequences run in document order, so one forward pointer pairs them:
  // for each anchor, take the last thumbnail date above it that no earlier
  // anchor has already claimed.
  //
  // **The pointer advances before any `continue`, and that is load-bearing in
  // one case only** — a skipped anchor whose item has a thumbnail, followed by
  // an item that has none. Advancing late would hand the skipped item's day to
  // the next headline instead of leaving it null. Items with no thumbnail are
  // 0.3% of them, so the case is rare rather than hypothetical.
  const dates: { at: number; date: string }[] = []
  for (const match of html.matchAll(IMG_DATE_RE)) {
    dates.push({ at: match.index ?? 0, date: `${match[1]}-${match[2]}-${match[3]}` })
  }
  let nextDate = 0

  for (const match of html.matchAll(ANCHOR_RE)) {
    const anchorAt = match.index ?? 0
    let published: string | null = null
    while (nextDate < dates.length && dates[nextDate].at < anchorAt) {
      published = dates[nextDate].date
      nextDate += 1
    }

    const [, attrs, inner] = match
    const hrefMatch = HREF_RE.exec(attrs)
    if (!hrefMatch) continue
    const link = canonicalLink(hrefMatch[1])
    if (seenLinks.has(link)) continue

    const strongMatch = STRONG_RE.exec(inner)
    const rawTitle = strongMatch ? strongMatch[1] : inner
    // NFC folds the CJK compatibility ideographs Naver uses interchangeably with
    // the ordinary ones (李 U+F9E1 / 李 U+674E, and 金, 勞, 盧, 女 likewise) onto
    // one code point. They render identically, so an unnormalised title is a
    // difference nothing on screen can show — and it reaches further than the
    // title: keyword_signals' `standalone` matches the word against this string,
    // so a word normalised on its own while the title was not would score 0.00
    // and be cut as a fragment. Normalising here keeps both sides in one form
    // and hands ETRI text that is already NFC. See migration 0012.
    const title = decodeHtmlEntities(stripTags(rawTitle)).normalize('NFC')
    if (!title) continue

    seenLinks.add(link)
    results.push({ title, link, published })
  }

  return results
}

export interface ListCursor {
  hasNext: boolean
  cursor: string
  pageNo: number
}

// The section list container carries its paging state as data attributes. The
// cursor is a YYYYMMDDHHMMSS stamp of the oldest article on the page, and the
// "더보기" endpoint takes it plus the page number to return the next batch.
const CURSOR_RE = /data-has-next="(true|false)"[^>]*data-cursor="(\d*)"[^>]*data-page-no="(\d+)"/

export function extractListCursor(html: string): ListCursor | null {
  const match = CURSOR_RE.exec(html)
  if (!match) return null
  return { hasNext: match[1] === 'true', cursor: match[2], pageNo: Number(match[3]) }
}

/**
 * Has this page reached back past the start of `date` (`YYYY-MM-DD`)?
 *
 * The cursor is the stamp of the **oldest** article on the page just read, so a
 * `true` here means the next page cannot hold anything from `date` at all and
 * paging may stop. It is not a statement about the page it was read from: that
 * page straddles the boundary and still holds articles worth keeping, which is
 * why the per-article `published` field exists as well.
 *
 * **The two have to be separate, and page 1 is why.** The first page opens with
 * the section's curated headline block, which is not in publication order —
 * 2026-08-05 12:30 KST had three 08-04 articles inside the first 46 of politics
 * under a cursor still stamped 08-05. A rule that stopped at the first old
 * article would have cut that page off at rank 3.
 *
 * A missing or malformed cursor answers `false`: paging on and letting the cap
 * stop the run costs at most one page of articles that get filtered anyway,
 * while a `true` would silently shorten every scrape.
 */
export function cursorIsBefore(cursor: ListCursor | null, date: string): boolean {
  const stamp = cursor?.cursor
  if (!stamp || stamp.length < 8) return false
  return stamp.slice(0, 8) < date.replace(/-/g, '')
}

// The pagination endpoint answers with JSON that wraps the same list markup the
// first page ships inline, so extractHeadlines can parse it unchanged.
export function extractTemplateListHtml(payload: unknown): string {
  const rendered = (payload as { renderedComponent?: Record<string, unknown> } | null)
    ?.renderedComponent
  const html = rendered?.SECTION_ARTICLE_LIST
  return typeof html === 'string' ? html : ''
}
