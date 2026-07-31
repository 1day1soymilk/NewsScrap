import { describe, expect, it } from 'vitest'
import { extractHeadlines, extractListCursor, extractTemplateListHtml } from './headlines'

const SAMPLE_HTML = `
<li class="sa_item">
  <div class="sa_text">
    <a href="https://n.news.naver.com/mnews/article/087/0001208610" class="sa_text_title _NLOG_IMPRESSION" data-clk="pol.clart">
      <strong class="sa_text_strong">[속보]김의겸 &quot;24년전 발언은 사실과 다르다&quot;</strong>
    </a>
    <div class="sa_text_lede">기사 요약...</div>
  </div>
</li>
<li class="sa_item">
  <div class="sa_text">
    <a href="https://n.news.naver.com/mnews/article/001/0016226272" class="sa_text_title _NLOG_IMPRESSION" data-clk="pol.clart">
      <strong class="sa_text_strong">여야, 예산안 처리 &amp; 협상 재개</strong>
    </a>
  </div>
</li>
`

describe('extractHeadlines', () => {
  it('extracts title and link for each headline anchor', () => {
    const result = extractHeadlines(SAMPLE_HTML)

    expect(result).toEqual([
      {
        title: '[속보]김의겸 "24년전 발언은 사실과 다르다"',
        link: 'https://n.news.naver.com/mnews/article/087/0001208610',
      },
      {
        title: '여야, 예산안 처리 & 협상 재개',
        link: 'https://n.news.naver.com/mnews/article/001/0016226272',
      },
    ])
  })

  it('returns an empty array when there are no matching anchors', () => {
    expect(extractHeadlines('<html><body>no headlines here</body></html>')).toEqual([])
  })

  it('matches anchors where sa_text_title is not the first class', () => {
    const html = `
<li class="sa_item">
  <div class="sa_text">
    <a href="https://n.news.naver.com/mnews/article/055/0001199999" class="_NLOG_IMPRESSION sa_text_title" data-clk="pol.clart">
      <strong class="sa_text_strong">국회, 본회의 개최</strong>
    </a>
  </div>
</li>
`
    expect(extractHeadlines(html)).toEqual([
      {
        title: '국회, 본회의 개최',
        link: 'https://n.news.naver.com/mnews/article/055/0001199999',
      },
    ])
  })

  it('deduplicates repeated links', () => {
    const html = SAMPLE_HTML + SAMPLE_HTML
    const result = extractHeadlines(html)
    expect(result).toHaveLength(2)
  })
})

// Taken verbatim from a live section page; the paging state rides on the list
// container as data attributes.
const LIST_CONTAINER =
  '<div class="section_latest_article _CONTENT_LIST _PERSIST_META" data-sid="100" data-sid2="" ' +
  'data-cluid="" data-has-next="true" data-cursor-name="next" data-cursor="20260731135814" ' +
  'data-page-no="1" data-date="" data-template="SECTION_ARTICLE_LIST">'

describe('extractListCursor', () => {
  it('reads the paging state off the list container', () => {
    expect(extractListCursor(LIST_CONTAINER)).toEqual({
      hasNext: true,
      cursor: '20260731135814',
      pageNo: 1,
    })
  })

  it('reports hasNext false on the last page', () => {
    const lastPage = LIST_CONTAINER.replace('data-has-next="true"', 'data-has-next="false"')
    expect(extractListCursor(lastPage)).toEqual({
      hasNext: false,
      cursor: '20260731135814',
      pageNo: 1,
    })
  })

  it('returns null when the container is absent', () => {
    expect(extractListCursor('<div>no list here</div>')).toBeNull()
  })
})

describe('extractTemplateListHtml', () => {
  it('unwraps the rendered list markup', () => {
    const payload = { renderedComponent: { SECTION_ARTICLE_LIST: '<div>markup</div>' } }
    expect(extractTemplateListHtml(payload)).toBe('<div>markup</div>')
  })

  it('returns an empty string for payloads without the list component', () => {
    expect(extractTemplateListHtml({ renderedComponent: {} })).toBe('')
    expect(extractTemplateListHtml({})).toBe('')
    expect(extractTemplateListHtml(null)).toBe('')
  })
})
