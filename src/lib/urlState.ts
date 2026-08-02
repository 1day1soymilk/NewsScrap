// The whole of the app's shareable state: which day, which section, which word.
// Kept in the query string so a reload, a bookmark or a pasted link lands on the
// same picture. react-router would be a dependency and a router for one route;
// history.pushState plus popstate is the entire mechanism this needs.

export interface UrlState {
  date: string | null
  category: string | null
  word: string | null
  /**
   * 선택된 사건의 첫 단어(그 사건 안에서 기사 수 1위). 인덱스가 아닌 이유는
   * 데이터가 움직이면 인덱스가 다른 사건을 가리키기 때문이고, 단어 목록
   * 전체가 아닌 이유는 URL이 감당하기에 길기 때문이다.
   *
   * `word`와 상호 배타다.
   */
  event: string | null
}

export const EMPTY_URL_STATE: UrlState = {
  date: null,
  category: null,
  word: null,
  event: null,
}

/**
 * @param knownSlugs category slugs to validate against. Pass an empty array
 *   before the categories query has resolved: an unrecognised slug is dropped,
 *   but "not yet known" must not count as unrecognised.
 */
export function parseUrlState(search: string, knownSlugs: string[]): UrlState {
  const params = new URLSearchParams(search)

  const date = params.get('date')
  const category = params.get('category')
  const word = params.get('word')
  const event = params.get('event')

  return {
    date: date && isCalendarDate(date) ? date : null,
    // An unknown slug would leave every tab unselected while the graph query
    // filtered on something no category matches — an unreachable state from the
    // UI, so a hand-edited URL must not be able to produce it either.
    category:
      category && (knownSlugs.length === 0 || knownSlugs.includes(category)) ? category : null,
    word: word ? word : null,
    // 손으로 고친 링크는 둘 다 담을 수 있다. 단어와 사건이 동시에 선택된
    // 상태는 UI가 만들 수 없고 캔버스에서 읽을 수도 없으므로, 하나를 버린다.
    event: word ? null : event ? event : null,
  }
}

export function toSearch(state: UrlState): string {
  const params = new URLSearchParams()
  // Insertion order is what the reader sees; date first reads as the coarsest
  // filter, which is also the order the controls sit in.
  if (state.date) params.set('date', state.date)
  if (state.category) params.set('category', state.category)
  if (state.word) params.set('word', state.word)
  else if (state.event) params.set('event', state.event)

  const query = params.toString()
  return query ? `?${query}` : ''
}

export function sameState(a: UrlState, b: UrlState): boolean {
  return (
    a.date === b.date &&
    a.category === b.category &&
    a.word === b.word &&
    a.event === b.event
  )
}

// A regex alone accepts 2026-02-30 and 2026-13-01. Round-tripping through Date
// rejects both: an out-of-range month is unparseable, and a day past the end of
// the month either fails to parse or rolls forward into a different string.
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}
