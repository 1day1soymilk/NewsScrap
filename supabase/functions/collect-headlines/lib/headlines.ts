export interface ScrapedHeadline {
  title: string
  link: string
}

// sa_text_title may appear anywhere in the class list, not just first.
const ANCHOR_RE = /<a\b([^>]*class="[^"]*\bsa_text_title\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g
const HREF_RE = /href="([^"]+)"/
const STRONG_RE = /<strong[^>]*>([\s\S]*?)<\/strong>/

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

  for (const match of html.matchAll(ANCHOR_RE)) {
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
    results.push({ title, link })
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

// The pagination endpoint answers with JSON that wraps the same list markup the
// first page ships inline, so extractHeadlines can parse it unchanged.
export function extractTemplateListHtml(payload: unknown): string {
  const rendered = (payload as { renderedComponent?: Record<string, unknown> } | null)
    ?.renderedComponent
  const html = rendered?.SECTION_ARTICLE_LIST
  return typeof html === 'string' ? html : ''
}
