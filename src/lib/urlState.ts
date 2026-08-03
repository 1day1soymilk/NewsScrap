// The whole of the app's shareable state: which day, which section, which word.
// Kept in the query string so a reload, a bookmark or a pasted link lands on the
// same picture. react-router would be a dependency and a router for one route;
// history.pushState plus popstate is the entire mechanism this needs.

export interface UrlState {
  date: string | null
  category: string | null
  word: string | null
  /**
   * The first word of the selected event — the member holding the most
   * headlines. Not an index, because an index points at a different event once
   * the data moves; not the whole member list, because that is too long for a
   * URL to carry.
   *
   * Mutually exclusive with `word`.
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
    // A hand-edited link can carry both. A word and an event selected at once
    // is a state the UI cannot produce and the canvas cannot be read in, so one
    // of them is dropped.
    event: word ? null : event ? event : null,
  }
}

/**
 * The current URL's state, read before the categories query has resolved — so
 * slugs cannot be validated yet, and parseUrlState takes an empty list to mean
 * "not yet known" rather than "nothing is valid". App.tsx re-checks once they
 * arrive, and main.tsx needs the same reading before React mounts.
 *
 * `date` stays null when the URL carries none. **Do not default it here**: the
 * URL-sync effect compares this against the app's state to decide whether to
 * write, and a defaulted date makes an empty URL compare equal to the opening
 * view. The first write is then skipped, so the write after it is a replaceState
 * rather than a pushState and Back stops working. Callers that need a concrete
 * day apply `?? todayInSeoul()` themselves.
 */
export function stateFromUrl(): UrlState {
  return parseUrlState(window.location.search, [])
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
