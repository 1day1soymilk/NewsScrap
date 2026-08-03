// src/lib/queryCache.ts
//
// Looking at the same day and section again is the normal way this screen is
// used — flipping a tab A→B→A, or stepping a date there and back. Without a
// cache each of those re-issues the same keyword_graph RPC, the same three
// surge requests and the same event_headline_counts.
//
// **What is saved is not only the network.** Every memo in App.tsx compares
// identities, so handing back the same object skips everything downstream: 70
// canvas text measurements, the Louvain partition, the 300-tick simulation and
// the edge routing. That is why what is stored here is a **promise rather than
// a result** — the second caller gets the very object the first one made, and
// in-flight deduplication falls out of the same code for free.

// A past day's data never changes, but today's does when the 07:00 KST cron
// runs, and a tab can be left open across that boundary.
export const CACHE_TTL_MS = 5 * 60 * 1000

// A day's screen is seven views (six sections plus all), so several days of
// browsing fit. The cap is here to bound growth in a long-lived tab, not to
// maximise the hit rate.
export const CACHE_MAX_ENTRIES = 24

interface Entry {
  /**
   * When the request went out. Deliberately not refreshed on a read: otherwise
   * a key that keeps being read would look fresh forever and today's graph
   * would never cross the cron boundary.
   */
  at: number
  value: Promise<unknown>
  /** Whether the response has arrived. This is what isReady reports. */
  settled: boolean
}

const entries = new Map<string, Entry>()

function live(key: string): Entry | undefined {
  const held = entries.get(key)
  return held && Date.now() - held.at < CACHE_TTL_MS ? held : undefined
}

export function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  const held = live(key)
  if (held) return held.value as Promise<T>

  const value = run()
  // Map keeps insertion order, so that order is age order. An existing key has
  // to be deleted before it is set again or it keeps its old position.
  entries.delete(key)
  const entry: Entry = { at: Date.now(), value, settled: false }
  entries.set(key, entry)

  value.then(
    () => {
      entry.settled = true
    },
    () => {
      // Failures are not kept. A retry button that hands back the same error
      // for five minutes is not a retry.
      if (entries.get(key) === entry) entries.delete(key)
    },
  )

  while (entries.size > CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next()
    if (oldest.done) break
    entries.delete(oldest.value)
  }
  return value
}

/**
 * Is there **nothing to wait for** on this key right now?
 *
 * Holding a slot is not enough — a request still in flight holds one too, and
 * that one has to be waited for. Whether the screen raises a skeleton hangs on
 * this answer, and this function exists so that nobody has to infer it from the
 * order in which promises happen to resolve.
 */
export function isReady(key: string): boolean {
  return live(key)?.settled ?? false
}

export interface CachedQuery<A extends unknown[], T> {
  (...args: A): Promise<T>
  /** Whether calling with these arguments would have to wait. */
  isReady(...args: A): boolean
}

/**
 * Wrap a query so it is cached under a key derived from its arguments.
 *
 * Applied by hand, each function grows a thin exported shell plus a renamed
 * private body — and that pair was repeated six times, which duplicates the way
 * caching is applied rather than the caching itself. Give the key rule and the
 * query; everything else happens once, here.
 */
export function cachedQuery<A extends unknown[], T>(
  keyOf: (...args: A) => string,
  run: (...args: A) => Promise<T>,
): CachedQuery<A, T> {
  const query = (...args: A) => cached(keyOf(...args), () => run(...args))
  query.isReady = (...args: A) => isReady(keyOf(...args))
  return query
}

export function clearQueryCache(): void {
  entries.clear()
}
