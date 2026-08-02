import { describe, expect, it } from 'vitest'
import { parseUrlState, sameState, toSearch } from './urlState'

const SLUGS = ['politics', 'economy', 'society']

describe('parseUrlState', () => {
  it('reads all three keys', () => {
    expect(parseUrlState('?date=2026-07-31&category=economy&word=금리', SLUGS)).toEqual({
      date: '2026-07-31',
      category: 'economy',
      word: '금리',
      event: null,
    })
  })

  it('returns nulls for an empty query string', () => {
    expect(parseUrlState('', SLUGS)).toEqual({
      date: null,
      category: null,
      word: null,
      event: null,
    })
  })

  it('decodes a percent-encoded Korean word', () => {
    expect(parseUrlState(`?word=${encodeURIComponent('폭염')}`, SLUGS).word).toBe('폭염')
  })

  // A hand-edited or stale URL must not put the app into a state the UI cannot
  // represent: an unknown slug would leave every category tab unselected while
  // the graph query filtered on nothing recognisable.
  it('drops a category that is not a known slug', () => {
    expect(parseUrlState('?category=sports', SLUGS).category).toBeNull()
  })

  it('accepts any slug when the category list has not loaded yet', () => {
    // Categories arrive from a second query, so on first paint the list is
    // empty. Rejecting everything then would discard a shared link's category
    // before it could ever be validated.
    expect(parseUrlState('?category=economy', []).category).toBe('economy')
  })

  it.each(['2026-7-31', '20260731', 'yesterday', '2026-13-01', '2026-02-30'])(
    'drops a malformed date (%s)',
    (date) => {
      expect(parseUrlState(`?date=${date}`, SLUGS).date).toBeNull()
    },
  )

  it('drops an empty word rather than selecting the empty string', () => {
    expect(parseUrlState('?word=', SLUGS).word).toBeNull()
  })
})

describe('toSearch', () => {
  it('omits keys that are null', () => {
    expect(toSearch({ date: '2026-07-31', category: null, word: null, event: null })).toBe(
      '?date=2026-07-31',
    )
  })

  it('encodes a Korean word', () => {
    expect(toSearch({ date: null, category: null, word: '폭염', event: null })).toBe(
      `?word=${encodeURIComponent('폭염')}`,
    )
  })

  it('is empty when nothing is set, so the bare path stays bare', () => {
    expect(toSearch({ date: null, category: null, word: null, event: null })).toBe('')
  })

  it('round-trips through parseUrlState', () => {
    const state = { date: '2026-08-01', category: 'society', word: '폭염', event: null }
    expect(parseUrlState(toSearch(state), SLUGS)).toEqual(state)
  })
})

describe('sameState', () => {
  it('is true for equal states', () => {
    expect(
      sameState(
        { date: '2026-08-01', category: null, word: '폭염', event: null },
        { date: '2026-08-01', category: null, word: '폭염', event: null },
      ),
    ).toBe(true)
  })

  it.each([
    ['date', { date: '2026-07-31', category: null, word: null, event: null }],
    ['category', { date: '2026-08-01', category: 'economy', word: null, event: null }],
    ['word', { date: '2026-08-01', category: null, word: '폭염', event: null }],
  ])('is false when %s differs', (_key, other) => {
    expect(
      sameState({ date: '2026-08-01', category: null, word: null, event: null }, other),
    ).toBe(false)
  })
})

describe('event', () => {
  it('사건의 첫 단어를 읽는다', () => {
    expect(parseUrlState(`?event=${encodeURIComponent('폭염')}`, SLUGS).event).toBe('폭염')
  })

  it('둘 다 있으면 word가 이긴다', () => {
    // 단어 선택과 사건 선택은 상호 배타다. 둘 다 켜진 상태는 캔버스에서 무엇이
    // 살아 있는지 읽을 수 없다.
    const state = parseUrlState('?word=폭염&event=트럼프', SLUGS)
    expect(state.word).toBe('폭염')
    expect(state.event).toBeNull()
  })

  it('toSearch가 event를 쓰고, word가 있으면 event를 쓰지 않는다', () => {
    expect(toSearch({ date: null, category: null, word: null, event: '폭염' })).toBe(
      `?event=${encodeURIComponent('폭염')}`,
    )
    expect(toSearch({ date: null, category: null, word: '금리', event: '폭염' })).toBe(
      `?word=${encodeURIComponent('금리')}`,
    )
  })

  it('sameState가 event를 본다', () => {
    const base = { date: '2026-07-31', category: null, word: null, event: '폭염' }
    expect(sameState(base, { ...base })).toBe(true)
    expect(sameState(base, { ...base, event: '트럼프' })).toBe(false)
  })
})
