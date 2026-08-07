import { describe, expect, it } from 'vitest'
import {
  canonicalLink,
  cursorIsBefore,
  extractHeadlines,
  extractListCursor,
  extractTemplateListHtml,
} from './headlines'

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

describe('canonicalLink', () => {
  // 섹션 첫 페이지는 인라인 HTML로 mnews 경로를 주고, "더보기" 페이지네이션은
  // 같은 기사에 mnews 없는 경로를 준다. 삽입 시 중복 검사는 링크 문자열 전체를
  // 맞춰 보므로 이 둘이 합쳐지지 않으면 같은 기사가 두 행이 된다.
  it('drops the mnews segment', () => {
    expect(canonicalLink('https://n.news.naver.com/mnews/article/001/0016225981')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
  })

  it('leaves an already canonical link alone', () => {
    expect(canonicalLink('https://n.news.naver.com/article/001/0016225921')).toBe(
      'https://n.news.naver.com/article/001/0016225921',
    )
  })

  // 아카이브의 3,120행에는 쿼리스트링이 하나도 없지만, 링크는 재구성으로
  // 만들어지므로 이것들은 공짜로 떨어져 나간다.
  it('drops a query string, a hash and a trailing slash', () => {
    expect(canonicalLink('https://n.news.naver.com/mnews/article/001/0016225981?sid=100')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
    expect(canonicalLink('https://n.news.naver.com/article/001/0016225981#comment')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
    expect(canonicalLink('https://n.news.naver.com/article/001/0016225981/')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
  })

  // 네이버가 URL 모양을 바꾸면 뭉개는 것보다 통과시키는 편이 낫다. 뭉개면 서로
  // 다른 기사가 한 링크로 합쳐져 조용히 사라진다.
  it('returns anything it cannot parse unchanged', () => {
    expect(canonicalLink('https://n.news.naver.com/hotissue/ranking')).toBe(
      'https://n.news.naver.com/hotissue/ranking',
    )
    expect(canonicalLink('/article/abc/def')).toBe('/article/abc/def')
    expect(canonicalLink('')).toBe('')
  })

  // The oid/aid pair is a global article key on Naver's side, so rebuilding
  // from the path tail is safe regardless of which host it was read off —
  // two different articles cannot collide on the same pair.
  it('rebuilds onto n.news.naver.com from a parseable path on a different Naver host', () => {
    expect(canonicalLink('https://news.naver.com/article/001/0016225981')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
  })

  // Same reasoning with no host at all: the path tail alone identifies the
  // article, so a bare path is enough to rebuild the canonical link.
  it('rebuilds onto n.news.naver.com from a bare path with no host', () => {
    expect(canonicalLink('/article/001/0016225981')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
  })
})

describe('extractHeadlines', () => {
  it('extracts title and link for each headline anchor', () => {
    const result = extractHeadlines(SAMPLE_HTML)

    expect(result).toEqual([
      {
        title: '[속보]김의겸 "24년전 발언은 사실과 다르다"',
        link: 'https://n.news.naver.com/article/087/0001208610',
        published: null,
      },
      {
        title: '여야, 예산안 처리 & 협상 재개',
        link: 'https://n.news.naver.com/article/001/0016226272',
        published: null,
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
        link: 'https://n.news.naver.com/article/055/0001199999',
        published: null,
      },
    ])
  })

  it('deduplicates repeated links', () => {
    const html = SAMPLE_HTML + SAMPLE_HTML
    const result = extractHeadlines(html)
    expect(result).toHaveLength(2)
  })

  // 첫 페이지와 페이지네이션이 한 응답에 섞여 들어와도 한 건이어야 한다.
  // 2026-08-02 world 섹션에서 실제로 관측된 상황이다.
  it('merges the two link forms of one article into a single headline', () => {
    const html = `
<li class="sa_item"><div class="sa_text">
  <a href="https://n.news.naver.com/mnews/article/001/0016226272" class="sa_text_title">
    <strong>여야, 예산안 처리 협상 재개</strong>
  </a>
</div></li>
<li class="sa_item"><div class="sa_text">
  <a href="https://n.news.naver.com/article/001/0016226272" class="sa_text_title">
    <strong>여야, 예산안 처리 협상 재개</strong>
  </a>
</div></li>
`
    expect(extractHeadlines(html)).toEqual([
      {
        title: '여야, 예산안 처리 협상 재개',
        link: 'https://n.news.naver.com/article/001/0016226272',
        published: null,
      },
    ])
  })

  // 네이버 헤드라인은 같은 한자를 보통 한자와 CJK 호환 한자 두 가지로 쓴다.
  // 화면에서는 구별되지 않지만 서로 다른 문자열이라, 정규화하지 않으면 李대통령이
  // 두 단어가 되어 모든 집계가 갈린다. 2026-08-03에 아카이브에서 발견된 다섯 자:
  // 金 U+F90A, 勞 U+F92F, 盧 U+F933, 女 U+F981, 李 U+F9E1.
  //
  // 입력은 **반드시 이스케이프로** 만든다. 그냥 타이핑하면 입력과 기대값이 같은
  // 문자열이 되어 통과하면서 아무것도 검증하지 않는다. 글자를 "고치지" 말 것.
  it('normalises compatibility ideographs in the title to NFC', () => {
    const html = `
<li class="sa_item"><div class="sa_text">
  <a href="https://n.news.naver.com/article/001/0016226272" class="sa_text_title">
    <strong>李대통령, 金총리와 회동</strong>
  </a>
</div></li>
`
    const [headline] = extractHeadlines(html)
    expect(headline.title).toBe('李대통령, 金총리와 회동')
    // 문자열 비교가 깨지면 두 줄이 똑같아 보이므로, 코드포인트로도 확인한다.
    expect(headline.title.codePointAt(0)).toBe(0x674e)
  })
})

// The shape of one real list item, cut down: the thumbnail — whose origin path
// spells out the publication day — sits inside the same <li> and above the
// headline anchor.
function item(press: string, id: string, day: string | null, title: string) {
  const thumb = day === null
    ? ''
    : `<div class="sa_thumb"><a href="https://n.news.naver.com/mnews/article/${press}/${id}" class="sa_thumb_link">` +
      `<img data-src="https://mimgnews.pstatic.net/image/origin/${press}/${day}/${id}.jpg?type=nf220_150"></a></div>`
  return (
    `<li class="sa_item">${thumb}<div class="sa_text">` +
    `<a href="https://n.news.naver.com/mnews/article/${press}/${id}" class="sa_text_title">` +
    `<strong class="sa_text_strong">${title}</strong></a></div></li>`
  )
}

describe('extractHeadlines — publication day', () => {
  it('reads the day off the thumbnail path', () => {
    const [headline] = extractHeadlines(item('055', '0001378178', '2026/08/05', '카카오게임즈 적자 확대'))
    expect(headline.published).toBe('2026-08-05')
  })

  // **This is the assertion the day-boundary stop rests on.** The first page of
  // a section opens with the curated headline block, which is not in publication
  // order: on 2026-08-05 at 12:30 KST three 08-04 articles sat inside the first
  // 46 of politics. Pairing a date with the wrong headline would drop a current
  // article or keep a stale one, and both are silent.
  it('pairs each day with the headline it sits above, not with the next one', () => {
    const html =
      item('055', '0000000001', '2026/08/05', '오늘 기사') +
      item('001', '0000000002', '2026/08/04', '어제 기사') +
      item('022', '0000000003', '2026/08/05', '오늘 기사 둘')
    expect(extractHeadlines(html).map((h) => [h.link.slice(-10), h.published])).toEqual([
      ['0000000001', '2026-08-05'],
      ['0000000002', '2026-08-04'],
      ['0000000003', '2026-08-05'],
    ])
  })

  // An item with no thumbnail is 0.3% of them, measured over 676. It must come
  // back null rather than inheriting whatever date was above it — that would
  // make an unreadable article silently take its neighbour's day.
  it('answers null for a headline with no thumbnail, either side of a dated one', () => {
    const html =
      item('055', '0000000001', '2026/08/05', '썸네일 있는 기사') +
      item('001', '0000000002', null, '썸네일 없는 기사') +
      item('022', '0000000003', null, '썸네일 없는 기사 둘') +
      item('037', '0000000004', '2026/08/04', '썸네일 있는 기사 둘')
    expect(extractHeadlines(html).map((h) => h.published)).toEqual([
      '2026-08-05',
      null,
      null,
      '2026-08-04',
    ])
  })

  // A headline anchor the href regex cannot read is skipped, and it has to
  // consume its own thumbnail on the way out. The case where that shows is a
  // skipped item **with** a thumbnail followed by one **without**: leaving the
  // date behind hands 08-04 to an article the markup says nothing about, and a
  // wrong day here is not a null — it is a real article dropped as off-day.
  it('does not hand a skipped anchor\'s day to the next headline', () => {
    const html =
      '<li class="sa_item"><div class="sa_thumb"><img data-src="https://mimgnews.pstatic.net/image/origin/055/2026/08/04/0000000001.jpg"></div>' +
      '<div class="sa_text"><a class="sa_text_title"><strong>href 없는 기사</strong></a></div></li>' +
      item('001', '0000000002', null, '썸네일 없는 다음 기사')
    expect(extractHeadlines(html)).toEqual([
      {
        title: '썸네일 없는 다음 기사',
        link: 'https://n.news.naver.com/article/001/0000000002',
        published: null,
      },
    ])
  })
})

describe('cursorIsBefore', () => {
  const cursor = (stamp: string) => ({ hasNext: true, cursor: stamp, pageNo: 3 })

  it('is true once the page\'s oldest article predates the day', () => {
    expect(cursorIsBefore(cursor('20260804213711'), '2026-08-05')).toBe(true)
  })

  it('is false while the page still ends inside the day', () => {
    expect(cursorIsBefore(cursor('20260805043306'), '2026-08-05')).toBe(false)
    expect(cursorIsBefore(cursor('20260805000000'), '2026-08-05')).toBe(false)
  })

  // A missing or short cursor pages on and lets the cap stop the run: the extra
  // page's articles are filtered by their own date anyway, while answering true
  // would quietly shorten every scrape the moment Naver renamed an attribute.
  it('fails open on a missing or unreadable cursor', () => {
    expect(cursorIsBefore(null, '2026-08-05')).toBe(false)
    expect(cursorIsBefore(cursor(''), '2026-08-05')).toBe(false)
    expect(cursorIsBefore(cursor('202608'), '2026-08-05')).toBe(false)
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
