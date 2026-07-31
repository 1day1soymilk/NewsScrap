export interface ScrapedHeadline {
  title: string
  link: string
}

// sa_text_title may appear anywhere in the class list, not just first.
const ANCHOR_RE = /<a\b([^>]*class="[^"]*\bsa_text_title\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g
const HREF_RE = /href="([^"]+)"/
const STRONG_RE = /<strong[^>]*>([\s\S]*?)<\/strong>/

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
    const link = hrefMatch[1]
    if (seenLinks.has(link)) continue

    const strongMatch = STRONG_RE.exec(inner)
    const rawTitle = strongMatch ? strongMatch[1] : inner
    const title = decodeHtmlEntities(stripTags(rawTitle))
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
