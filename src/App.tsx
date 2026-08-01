// src/App.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { CategoryTabs } from './components/CategoryTabs'
import { HeadlinePanel } from './components/HeadlinePanel'
import { KeywordGraph } from './components/KeywordGraph'
import {
  fetchAvailableDates,
  fetchCategories,
  fetchHeadlineCount,
  fetchHeadlinesForWord,
  fetchKeywordGraph,
  fetchWordCountsFor,
} from './lib/queries'
import { adjacentDate } from './lib/dateNav'
import { computeSurges, surgeLimitFor } from './lib/surge'
import type { Surge } from './lib/surge'
import { parseUrlState, sameState, toSearch } from './lib/urlState'
import type { Category, HeadlineSummary, KeywordGraphData } from './lib/types'

const EMPTY_GRAPH: KeywordGraphData = { nodes: [], edges: [] }
const NO_SURGES: Map<string, Surge> = new Map()

function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

// Read before the categories query has resolved, so slugs cannot be validated
// yet; parseUrlState takes an empty list to mean "not yet known" rather than
// "nothing is valid". The check happens once they arrive.
function stateFromUrl() {
  return parseUrlState(window.location.search, [])
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState(() => stateFromUrl().date ?? todayInSeoul())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    () => stateFromUrl().category,
  )
  const [selectedWord, setSelectedWord] = useState<string | null>(() => stateFromUrl().word)
  const [graph, setGraph] = useState<KeywordGraphData>(EMPTY_GRAPH)
  const [surges, setSurges] = useState<Map<string, Surge>>(NO_SURGES)
  const [headlinesForWord, setHeadlinesForWord] = useState<HeadlineSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [headlinesLoading, setHeadlinesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [headlinesError, setHeadlinesError] = useState<string | null>(null)

  useEffect(() => {
    fetchCategories().then(setCategories).catch((e) => setError(errorMessage(e)))
    fetchAvailableDates().then(setAvailableDates).catch((e) => setError(errorMessage(e)))
  }, [])

  // A slug from a hand-edited or stale link that matches no section would leave
  // every tab unselected while the graph filtered on nothing — a state the UI
  // has no way to produce or to escape from.
  useEffect(() => {
    if (categories.length === 0 || selectedCategory === null) return
    if (!categories.some((category) => category.slug === selectedCategory)) {
      setSelectedCategory(null)
    }
  }, [categories, selectedCategory])

  // --- URL state ------------------------------------------------------------
  // history.pushState and popstate, rather than a router: there is one route.

  const urlSynced = useRef(false)

  useEffect(() => {
    const next = { date: selectedDate, category: selectedCategory, word: selectedWord }
    if (sameState(stateFromUrl(), next)) return

    // The first write only fills in the date the app defaulted to. Pushing it
    // would put a duplicate of the current view on the stack, and the first
    // press of Back would appear to do nothing.
    const write = urlSynced.current ? window.history.pushState : window.history.replaceState
    write.call(window.history, null, '', `${window.location.pathname}${toSearch(next)}`)
    urlSynced.current = true
  }, [selectedDate, selectedCategory, selectedWord])

  useEffect(() => {
    function onPopState() {
      const state = stateFromUrl()
      setSelectedDate(state.date ?? todayInSeoul())
      setSelectedCategory(state.category)
      setSelectedWord(state.word)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // --- Data -----------------------------------------------------------------

  function loadGraph(isCancelled: () => boolean = () => false) {
    setLoading(true)
    setError(null)
    fetchKeywordGraph(selectedDate, selectedCategory)
      .then((data) => {
        if (isCancelled()) return
        setGraph(data)
      })
      .catch((e) => {
        if (isCancelled()) return
        setError(errorMessage(e))
      })
      .finally(() => {
        if (isCancelled()) return
        setLoading(false)
      })
  }

  useEffect(() => {
    let cancelled = false
    loadGraph(() => cancelled)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedCategory])

  const previousDate = useMemo(
    () => adjacentDate(availableDates, selectedDate, 'prev'),
    [availableDates, selectedDate],
  )
  const nextDate = useMemo(
    () => adjacentDate(availableDates, selectedDate, 'next'),
    [availableDates, selectedDate],
  )

  // Day-over-day movement, always read across all six sections. The sieve
  // counts headlines day-wide and so does this: which tab is on screen decides
  // what is shown, never what a word did that day.
  //
  // Only the words on the graph are asked about, which is what keeps both
  // responses far inside PostgREST's 1,000-row cap; the denominators are
  // server-side counts for the same reason. A day holds 3,289 distinct words,
  // so a query that asked for all of them would be truncated and every ratio
  // computed from it would be wrong.
  const graphWords = useMemo(() => graph.nodes.map((node) => node.word), [graph.nodes])

  useEffect(() => {
    if (!previousDate || graphWords.length === 0) {
      setSurges(NO_SURGES)
      return
    }
    let cancelled = false
    Promise.all([
      fetchWordCountsFor([selectedDate, previousDate], graphWords),
      fetchHeadlineCount(selectedDate),
      fetchHeadlineCount(previousDate),
    ])
      .then(([counts, todayHeadlines, previousHeadlines]) => {
        if (cancelled) return
        setSurges(
          computeSurges(
            { counts: counts.get(selectedDate) ?? [], headlines: todayHeadlines },
            { counts: counts.get(previousDate) ?? [], headlines: previousHeadlines },
            { limit: surgeLimitFor(graphWords.length) },
          ),
        )
      })
      .catch(() => {
        // Deliberately not surfaced. The markers annotate a graph that is
        // already readable without them, so losing them degrades to the
        // previous behaviour rather than to an error page.
        if (cancelled) return
        setSurges(NO_SURGES)
      })
    return () => {
      cancelled = true
    }
  }, [selectedDate, previousDate, graphWords])

  useEffect(() => {
    setHeadlinesError(null)
    if (!selectedWord) {
      setHeadlinesForWord([])
      setHeadlinesLoading(false)
      return
    }
    let cancelled = false
    setHeadlinesLoading(true)
    fetchHeadlinesForWord(selectedDate, selectedCategory, selectedWord)
      .then((data) => {
        if (cancelled) return
        setHeadlinesForWord(data)
      })
      .catch((e) => {
        if (cancelled) return
        setHeadlinesError(errorMessage(e))
      })
      .finally(() => {
        if (cancelled) return
        setHeadlinesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedWord, selectedDate, selectedCategory])

  return (
    <div className="min-h-svh bg-ground text-ink">
      {/* Sticky so the date and the tabs stay reachable while the graph is
          scrolled. The panel is offset below this in HeadlinePanel, or it
          would cover the controls it is a response to. */}
      {/* The bar carries only what has to stay reachable while the graph is
          scrolled: the wordmark and the sections. The date moved out of it and
          into the masthead below, where it is the subject of the page rather
          than one more control in a row of them. */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-sm font-medium tracking-[0.2em] text-ink-muted uppercase">
            뉴스 스크랩
          </h1>
          <CategoryTabs categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-8 sm:px-6">
        <Masthead
          date={selectedDate}
          minDate={availableDates[availableDates.length - 1]}
          maxDate={availableDates[0]}
          previousDate={previousDate}
          nextDate={nextDate}
          onDateChange={setSelectedDate}
          words={!error && !loading ? graph.nodes.length : null}
          links={!error && !loading ? graph.edges.length : null}
        />

        {error && (
          <div className="text-center">
            <p className="mb-2 text-danger">{error}</p>
            <button
              onClick={() => loadGraph()}
              className="rounded-md border border-line bg-surface px-3 py-1 text-sm text-ink-muted hover:text-ink"
            >
              다시 시도
            </button>
          </div>
        )}
        {!error && loading && <GraphSkeleton />}
        {!error && !loading && (
          // A transform rather than a narrower container: the layout is a
          // function of the measured width, so shrinking the box would move
          // every word the moment a word was clicked. transform does not change
          // contentRect, so the ResizeObserver inside the graph never fires and
          // the picture slides intact out from under the panel.
          <div
            className={`origin-top transition-transform duration-300 motion-reduce:transition-none ${
              selectedWord ? 'sm:-translate-x-24 sm:scale-90' : ''
            }`}
          >
            <KeywordGraph
              graph={graph}
              selectedWord={selectedWord}
              // Clicking a lit word again clears the focus and closes the panel.
              onWordClick={(word) => setSelectedWord((current) => (current === word ? null : word))}
              colorByCategory={selectedCategory === null}
              surges={surges}
            />
          </div>
        )}
      </main>

      <HeadlinePanel
        word={selectedWord}
        headlines={headlinesForWord}
        categories={categories}
        loading={headlinesLoading}
        error={headlinesError}
        onClose={() => setSelectedWord(null)}
      />
    </div>
  )
}

// The page is a dated record, so the date is what it is about — not a form
// control tucked between a title and a row of tabs, which is where it used to
// live. Set in 명조 against a canvas that is entirely 고딕: the masthead is the
// one part of the page that gets read rather than scanned.
//
// The stepper walks the collected dates rather than the calendar, because the
// archive has gaps and today is empty until the 07:00 KST cron has run. The
// native picker stays for jumping further than one step.
function Masthead({
  date,
  minDate,
  maxDate,
  previousDate,
  nextDate,
  onDateChange,
  words,
  links,
}: {
  date: string
  minDate?: string
  maxDate?: string
  previousDate: string | null
  nextDate: string | null
  onDateChange: (date: string) => void
  words: number | null
  links: number | null
}) {
  const parts = formatDate(date)
  const step =
    'rounded-md px-1.5 text-2xl leading-none text-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-ink-faint'

  return (
    // Everything sits in one left-aligned column. The picker used to be floated
    // to the right edge, where the headline panel — which starts below the
    // toolbar and runs to the bottom — covered it the moment a word was clicked.
    <div className="mb-6">
      <div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => previousDate && onDateChange(previousDate)}
            disabled={!previousDate}
            aria-label="이전 수집일"
            className={step}
          >
            ‹
          </button>
          <p className="font-display text-3xl leading-none font-semibold tracking-tight sm:text-4xl">
            {parts.day}
            <span className="ml-2 align-baseline text-lg font-medium text-ink-faint sm:text-xl">
              {parts.weekday}
            </span>
          </p>
          <button
            onClick={() => nextDate && onDateChange(nextDate)}
            disabled={!nextDate}
            aria-label="다음 수집일"
            className={step}
          >
            ›
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2 pl-1 text-xs text-ink-faint">
          <span>{parts.year}</span>
          {words !== null && links !== null && (
            <>
              <span>·</span>
              <span>단어 {words}</span>
              <span>·</span>
              <span>관계 {links}</span>
            </>
          )}
          <span>·</span>
          {/* The stepper walks to the neighbouring collected date; this is for
              jumping further than one step, so it is the quieter of the two. */}
          <label className="flex items-center gap-1.5">
            <span className="sr-only">날짜 선택</span>
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-faint hover:text-ink"
            />
          </label>
        </div>
      </div>
    </div>
  )
}

// Invalid dates reach this from a hand-edited query string, and Intl renders
// those as "Invalid Date" rather than throwing — which would put that string in
// the masthead at 36px.
function formatDate(iso: string): { day: string; weekday: string; year: string } {
  const parsed = new Date(`${iso}T00:00:00+09:00`)
  if (Number.isNaN(parsed.getTime())) return { day: iso, weekday: '', year: '' }

  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...options }).format(parsed)

  return {
    day: format({ month: 'long', day: 'numeric' }),
    weekday: format({ weekday: 'short' }),
    year: format({ year: 'numeric' }),
  }
}

// Holds the graph's footprint while it loads, so the page does not collapse to
// one line of text and then jump back open. Deliberately not a fake graph:
// scattering placeholder words would suggest a layout that the real one is
// about to contradict.
function GraphSkeleton() {
  return (
    <div
      data-testid="graph-skeleton"
      role="status"
      aria-busy="true"
      aria-label="불러오는 중"
      className="mx-auto w-full max-w-5xl"
    >
      <div className="mx-auto mb-3 h-4 w-56 animate-pulse rounded-full bg-line" />
      <div className="h-[380px] w-full animate-pulse rounded-xl bg-ground" />
    </div>
  )
}

export default App
