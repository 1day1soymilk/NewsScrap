import { describe, expect, it } from 'vitest'
import { extractHeadlines } from './headlines'

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

  it('deduplicates repeated links', () => {
    const html = SAMPLE_HTML + SAMPLE_HTML
    const result = extractHeadlines(html)
    expect(result).toHaveLength(2)
  })
})
