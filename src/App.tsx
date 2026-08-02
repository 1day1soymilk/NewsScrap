// src/App.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CategoryTabs } from './components/CategoryTabs'
import { EventList } from './components/EventList'
import { GraphSkeleton } from './components/GraphSkeleton'
import { HeadlinePanel } from './components/HeadlinePanel'
import { KeywordGraph } from './components/KeywordGraph'
import { Masthead } from './components/Masthead'
import {
  fetchAvailableDates,
  fetchCategories,
  fetchEventHeadlineCounts,
  fetchHeadlineCount,
  fetchHeadlinesForEvent,
  fetchHeadlinesForWord,
  fetchKeywordGraph,
  fetchWordCountsFor,
} from './lib/queries'
import { adjacentDate } from './lib/dateNav'
import { buildEvents, eventLabel, eventsOf, sameCommunities, topEvents } from './lib/events'
import type { EventGraph } from './lib/events'
import { computeSurges, surgeLimitFor } from './lib/surge'
import type { Surge } from './lib/surge'
import { parseUrlState, sameState, toSearch } from './lib/urlState'
import type { Category, HeadlineSummary, KeywordGraphData } from './lib/types'

const EMPTY_GRAPH: KeywordGraphData = { nodes: [], edges: [] }
const NO_SURGES: Map<string, Surge> = new Map()
const NO_EVENTS: EventGraph = { events: [], bridges: new Map() }

// 루뱅 분할은 그것이 나온 그래프와 짝지어 들고 다닌다. 캔버스가 그린 **뒤의**
// effect에서 올라오기 때문이다 — 새 날의 그래프가 처음 그려지는 한 프레임 동안
// 이 Map은 아직 어제 것이다.
type Partition = { graph: KeywordGraphData; communities: Map<string, number> }

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
  const [selectedEvent, setSelectedEvent] = useState<string | null>(() => stateFromUrl().event)
  const [partition, setPartition] = useState<Partition | null>(null)
  const [eventCounts, setEventCounts] = useState<{ of: EventGraph; counts: number[] } | null>(null)
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
    const next = {
      date: selectedDate,
      category: selectedCategory,
      word: selectedWord,
      event: selectedEvent,
    }
    if (sameState(stateFromUrl(), next)) return

    // The first write only fills in the date the app defaulted to. Pushing it
    // would put a duplicate of the current view on the stack, and the first
    // press of Back would appear to do nothing.
    const write = urlSynced.current ? window.history.pushState : window.history.replaceState
    write.call(window.history, null, '', `${window.location.pathname}${toSearch(next)}`)
    urlSynced.current = true
  }, [selectedDate, selectedCategory, selectedWord, selectedEvent])

  useEffect(() => {
    function onPopState() {
      const state = stateFromUrl()
      setSelectedDate(state.date ?? todayInSeoul())
      setSelectedCategory(state.category)
      setSelectedWord(state.word)
      setSelectedEvent(state.event)
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

  // --- 사건 ------------------------------------------------------------------

  // 캔버스가 쓴 것과 같은 루뱅 분할을 그대로 받는다. 레이아웃은 폭에 반응하므로
  // 리사이즈마다 새 Map이 올라오지만, 배정은 위상만의 함수라 값이 바뀌지 않는다
  // — 내용을 비교해 재요청을 막는다.
  //
  // 올라온 분할은 **그것이 나온 그래프와 함께** 저장한다. 그것이 그래프와 거기서
  // 파생되는 모든 것 사이의 유일한 장벽이고, 두 개가 아니라 하나다: 날짜나
  // 카테고리가 바뀌면 graph의 신원이 바뀌고, 그 순간 짝이 어긋나 사건도 기사
  // 수도 목록도 한꺼번에 비어 버린다. 한 프레임 빈 목록이, 어제의 사건과 어제의
  // 숫자를 오늘 것처럼 내거는 것보다 낫다 — 그리고 하루의 사건 수는 세 날
  // 15/14/15라 배열 길이만으로는 어긋남을 알아차릴 수 없다.
  //
  // ref로 읽는 이유: 이 콜백은 KeywordGraph의 effect가 부르므로 그 시점의 graph는
  // 이미 방금 그려진 것이다. 콜백을 graph에 의존시키면 매 그래프마다 새 함수가
  // 되어 effect가 다시 돌고, 여기서 읽지 않고 렌더에만 쓰므로 값도 갈리지 않는다.
  const renderedGraph = useRef(graph)
  renderedGraph.current = graph

  const onCommunities = useCallback((next: Map<string, number>) => {
    const from = renderedGraph.current
    setPartition((current) =>
      current && current.graph === from && sameCommunities(current.communities, next)
        ? current
        : { graph: from, communities: next },
    )
  }, [])

  const eventGraph = useMemo(() => {
    if (!partition || partition.graph !== graph) return NO_EVENTS
    return buildEvents(
      graph.nodes.map((node) => ({ word: node.word, count: node.count })),
      graph.edges,
      partition.communities,
    )
  }, [graph, partition])

  // 하루의 사건 전부를 한 번에 센다. 상위 5개를 먼저 자르면 순위가 멤버 카운트의
  // 합으로 정해지는데, 그 합이 바로 이 요청이 고치려는 값이다 — 2026-08-01의
  // 실제 1위는 트럼프(합계 73 / 실제 51)가 아니라 폭염(69 / 61)이다.
  useEffect(() => {
    // 무엇이 바뀌었든 먼저 버린다. 사건 목록의 숫자는 이 요청의 답이지 이전
    // 요청의 답이 아니고, 그 둘은 길이만으로는 구별되지 않는다.
    setEventCounts(null)
    if (eventGraph.events.length === 0) return
    let cancelled = false
    fetchEventHeadlineCounts(
      selectedDate,
      selectedCategory,
      eventGraph.events.map((event) => event.words.map((word) => word.word)),
    )
      .then((counts) => {
        if (!cancelled) setEventCounts({ of: eventGraph, counts })
      })
      .catch(() => {
        // 목록은 그린다. 숫자 자리를 비운다. 사건 이름이 숫자보다 중요하고,
        // 목록 전체를 감추면 캡션조차 없어진다.
        if (!cancelled) setEventCounts(null)
      })
    return () => {
      cancelled = true
    }
  }, [eventGraph, selectedDate, selectedCategory])

  // 숫자는 그것을 물어본 바로 그 사건 목록에만 붙는다. 신원이 어긋나면 null로
  // 떨어지고 topEvents는 countSum 순서로 돌아간다 — 어제의 숫자로 오늘을 정렬하는
  // 일은 여기서 구조적으로 불가능하다.
  // 캔버스에서 누른 단어가 속한 사건들. 다리 단어는 닿는 사건 전부 — 캔버스의
  // focusWords가 다리에 대해 켜는 집합과 같다.
  //
  // 캔버스와 목록이 켜는 것이 서로 다른 것은 의도다: 캔버스는 단어와 그 이웃을
  // 켜고(사건 경계를 넘을 수 있다), 목록은 소속을 말한다. 다른 질문이므로
  // 일치시키지 않는다.
  const relatedEvents = useMemo(
    () => (selectedWord ? eventsOf(eventGraph, selectedWord) : []),
    [eventGraph, selectedWord],
  )

  const rankedEvents = useMemo(
    () =>
      topEvents(eventGraph.events, eventCounts?.of === eventGraph ? eventCounts.counts : null, {
        // 상위 5개 밖의 사건에 속한 단어를 눌러도 그 사건이 이름을 갖도록
        // 목록 끝에 한 줄 붙인다.
        pinned: relatedEvents,
      }),
    [eventGraph, eventCounts, relatedEvents],
  )

  const relatedTopWords = useMemo(
    () => new Set(relatedEvents.map((index) => eventGraph.events[index].words[0].word)),
    [eventGraph, relatedEvents],
  )

  const activeEvent = useMemo(() => {
    if (!selectedEvent) return null
    return eventGraph.events.find((event) => event.words[0].word === selectedEvent) ?? null
  }, [eventGraph, selectedEvent])

  // 사전 변경이나 재수집으로 그 단어가 그날 화면에서 사라졌으면 조용히 버린다 —
  // category가 이미 그렇게 동작한다. 사건이 0개인 동안은 아직 판단할 수 없으므로
  // 건드리지 않는다: 공유된 링크가 그래프가 도착하기 전에 버려지면 안 된다.
  useEffect(() => {
    if (selectedEvent === null || eventGraph.events.length === 0) return
    if (!eventGraph.events.some((event) => event.words[0].word === selectedEvent)) {
      setSelectedEvent(null)
    }
  }, [eventGraph, selectedEvent])

  // 캔버스에서 살아남는 단어들. 사건이면 멤버 전부, 다리 단어면 그 단어가 닿는
  // 모든 사건의 멤버 전부. 둘 다 아니면 null이고 KeywordGraph의 단어 포커스가
  // 그대로 돈다.
  const focusWords = useMemo(() => {
    if (activeEvent) return new Set(activeEvent.words.map((word) => word.word))
    if (!selectedWord) return null
    const touched = eventGraph.bridges.get(selectedWord)
    if (!touched) return null
    const lit = new Set<string>()
    for (const index of touched) {
      for (const word of eventGraph.events[index].words) lit.add(word.word)
    }
    return lit
  }, [activeEvent, selectedWord, eventGraph])

  // 패널 제목. 목록의 한 줄과 같은 규칙으로 자른다.
  const eventSubject = useMemo(() => {
    if (!activeEvent) return null
    const { shown, rest } = eventLabel(activeEvent.words)
    return rest > 0 ? `${shown.join(' · ')} 외 ${rest}` : shown.join(' · ')
  }, [activeEvent])

  useEffect(() => {
    setHeadlinesError(null)
    // 다리 단어를 눌러도 열리는 것은 **그 단어의** 헤드라인이다. 두 사건의
    // 헤드라인을 합쳐 열면 그 단어가 왜 접점인지가 오히려 묻힌다.
    const eventWords = activeEvent?.words.map((word) => word.word) ?? null
    if (!selectedWord && !eventWords) {
      setHeadlinesForWord([])
      setHeadlinesLoading(false)
      return
    }

    let cancelled = false
    setHeadlinesLoading(true)
    const request = selectedWord
      ? fetchHeadlinesForWord(selectedDate, selectedCategory, selectedWord)
      : fetchHeadlinesForEvent(selectedDate, selectedCategory, eventWords!)

    request
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
  }, [selectedWord, activeEvent, selectedDate, selectedCategory])

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
              selectedWord || selectedEvent ? 'sm:-translate-x-24 sm:scale-90' : ''
            }`}
          >
            <KeywordGraph
              graph={graph}
              selectedWord={selectedWord}
              // 단어를 누르면 사건 선택이 풀린다. 둘 다 켜진 상태는 캔버스에서
              // 무엇이 살아 있는지 읽을 수 없다.
              onWordClick={(word) => {
                setSelectedEvent(null)
                setSelectedWord((current) => (current === word ? null : word))
              }}
              colorByCategory={selectedCategory === null}
              surges={surges}
              focusWords={focusWords}
              onCommunities={onCommunities}
              header={
                <EventList
                  events={rankedEvents}
                  selected={selectedEvent}
                  related={relatedTopWords}
                  onSelect={(topWord) => {
                    setSelectedWord(null)
                    setSelectedEvent((current) => (current === topWord ? null : topWord))
                  }}
                />
              }
            />
          </div>
        )}
      </main>

      <HeadlinePanel
        subject={selectedWord ?? eventSubject}
        isEvent={!selectedWord && eventSubject !== null}
        headlines={headlinesForWord}
        categories={categories}
        loading={headlinesLoading}
        error={headlinesError}
        onClose={() => {
          setSelectedWord(null)
          setSelectedEvent(null)
        }}
      />
    </div>
  )
}


export default App
