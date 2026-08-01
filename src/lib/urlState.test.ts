import { describe, expect, it } from 'vitest'
import { parseUrlState, sameState, toSearch } from './urlState'

const SLUGS = ['politics', 'economy', 'society']

describe('parseUrlState', () => {
  it('reads all three keys', () => {
    expect(parseUrlState('?date=2026-07-31&category=economy&word=금리', SLUGS)).toEqual({
      date: '2026-07-31',
      category: 'economy',
      word: '금리',
    })
  })

  it('returns nulls for an empty query string', () => {
    expect(parseUrlState('', SLUGS)).toEqual({ date: null, category: null, word: null })
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
    expect(toSearch({ date: '2026-07-31', category: null, word: null })).toBe(
      '?date=2026-07-31',
    )
  })

  it('encodes a Korean word', () => {
    expect(toSearch({ date: null, category: null, word: '폭염' })).toBe(
      `?word=${encodeURIComponent('폭염')}`,
    )
  })

  it('is empty when nothing is set, so the bare path stays bare', () => {
    expect(toSearch({ date: null, category: null, word: null })).toBe('')
  })

  it('round-trips through parseUrlState', () => {
    const state = { date: '2026-08-01', category: 'society', word: '폭염' }
    expect(parseUrlState(toSearch(state), SLUGS)).toEqual(state)
  })
})

describe('sameState', () => {
  it('is true for equal states', () => {
    expect(
      sameState(
        { date: '2026-08-01', category: null, word: '폭염' },
        { date: '2026-08-01', category: null, word: '폭염' },
      ),
    ).toBe(true)
  })

  it.each([
    ['date', { date: '2026-07-31', category: null, word: null }],
    ['category', { date: '2026-08-01', category: 'economy', word: null }],
    ['word', { date: '2026-08-01', category: null, word: '폭염' }],
  ])('is false when %s differs', (_key, other) => {
    expect(sameState({ date: '2026-08-01', category: null, word: null }, other)).toBe(false)
  })
})
