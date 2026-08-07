// src/App.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CategoryShare } from './components/CategoryShare'
import { CategoryTabs } from './components/CategoryTabs'
import { EventList } from './components/EventList'
import { GraphSkeleton } from './components/GraphSkeleton'
import { HeadlinePanel } from './components/HeadlinePanel'
import { KeywordGraph } from './components/KeywordGraph'
import { Masthead } from './components/Masthead'
import {
  fetchCategories,
  fetchCategoryShare,
  fetchCollectedDates,
  fetchEventHeadlineCounts,
  fetchHeadlineCount,
  fetchHeadlinesForEvent,
  fetchHeadlinesForWord,
  fetchKeywordGraph,
  fetchWordCountsFor,
} from './lib/queries'
import { adjacentDate, todayInSeoul } from './lib/dateNav'
import { buildHistory } from './lib/history'
import type { HistoryPoint } from './lib/history'
import {
  EVENT_LIST_LIMIT,
  buildEvents,
  eventLabel,
  eventsOf,
  sameCommunities,
  topEvents,
} from './lib/events'
import type { EventGraph } from './lib/events'
import { computeSurges, surgeLimitFor } from './lib/surge'
import type { Surge } from './lib/surge'
import { sameState, stateFromUrl, toSearch } from './lib/urlState'
import type { CategoryShare as CategoryShareRow, CollectedDate } from './lib/queries'
import type { Category, HeadlineSummary, KeywordGraphData } from './lib/types'

const EMPTY_GRAPH: KeywordGraphData = { nodes: [], edges: [] }
const NO_SURGES: Map<string, Surge> = new Map()
const NO_EVENTS: EventGraph = { events: [], bridges: new Map() }
const NO_SHARE: CategoryShareRow[] = []

// A Louvain partition is carried around paired with the graph it came from,
// because it arrives from an effect that runs **after** the canvas has painted:
// for one frame, while a new day is first drawn, this Map still belongs to the
// previous one.
type Partition = { graph: KeywordGraphData; communities: Map<string, number> }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return String(e)
}

function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [collectedDates, setCollectedDates] = useState<CollectedDate[]>([])
  const [selectedDate, setSelectedDate] = useState(() => stateFromUrl().date ?? todayInSeoul())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    () => stateFromUrl().category,
  )
  const [selectedWord, setSelectedWord] = useState<string | null>(() => stateFromUrl().word)
  const [selectedEvent, setSelectedEvent] = useState<string | null>(() => stateFromUrl().event)
  const [partition, setPartition] = useState<Partition | null>(null)
  const [eventCounts, setEventCounts] = useState<{ of: EventGraph; counts: number[] } | null>(null)
  // Deliberately not in the query string: it is not a shareable claim about the
  // data, and the URL already carries a mutual-exclusion rule between ?word= and
  // ?event= that a third axis would only complicate.
  const [eventsExpanded, setEventsExpanded] = useState(false)
  const [graph, setGraph] = useState<KeywordGraphData>(EMPTY_GRAPH)
  const [categoryShare, setCategoryShare] = useState<CategoryShareRow[]>(NO_SHARE)
  const [surges, setSurges] = useState<Map<string, Surge>>(NO_SURGES)
  const [headlinesForWord, setHeadlinesForWord] = useState<HeadlineSummary[]>([])
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [headlinesLoading, setHeadlinesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [headlinesError, setHeadlinesError] = useState<string | null>(null)

  useEffect(() => {
    fetchCategories().then(setCategories).catch((e) => setError(errorMessage(e)))
    fetchCollectedDates().then(setCollectedDates).catch((e) => setError(errorMessage(e)))
  }, [])

  // One query answers two questions. The date stepper and the masthead want the
  // days; the surge comparison wants each day's headline total as the
  // denominator that makes two days of different sizes comparable.
  const availableDates = useMemo(() => collectedDates.map((day) => day.date), [collectedDates])
  const headlinesByDate = useMemo(
    () => new Map(collectedDates.map((day) => [day.date, day.headlines])),
    [collectedDates],
  )

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
    setError(null)
    // The skeleton is raised only when there is something to wait for. A view
    // already held by the cache resolves without a round trip, and flashing a
    // skeleton for that frame would undo the whole saving — nothing would look
    // any faster. The cache answers this directly rather than the answer being
    // inferred from the order promises happen to resolve in.
    setLoading(!fetchKeywordGraph.isReady(selectedDate, selectedCategory))

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

  // 그날 각 섹션이 실제로 낸 몫. 그래프와 독립된 데이터라 그래프의 오류·스켈레톤에
  // 얽히지 않고, 실패는 급상승 표식과 같은 방식으로 삼킨다 — 도넛이 없어도 화면은
  // 그대로 읽히고, 없는 편이 오류 페이지보다 낫다.
  useEffect(() => {
    let cancelled = false
    fetchCategoryShare(selectedDate)
      .then((rows) => {
        if (!cancelled) setCategoryShare(rows)
      })
      .catch(() => {
        if (!cancelled) setCategoryShare(NO_SHARE)
      })
    return () => {
      cancelled = true
    }
  }, [selectedDate])

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

    // The day totals ride along with the date list, so the common path costs no
    // request at all. The fallback is not decoration: collected_dates is one row
    // per collected day, which reaches PostgREST's 1,000-row cap in about 2.7
    // years, and a silently truncated denominator is the specific failure this
    // codebase has already paid for once. Being truncated then costs one request
    // rather than producing a wrong ratio for every word on screen.
    const headlineCount = (date: string) => headlinesByDate.get(date) ?? fetchHeadlineCount(date)

    Promise.all([
      fetchWordCountsFor([selectedDate, previousDate], graphWords),
      headlineCount(selectedDate),
      headlineCount(previousDate),
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
  }, [selectedDate, previousDate, graphWords, headlinesByDate])

  // 그 단어가 수집된 날들을 지나며 그날의 몇 퍼센트였는지. 사건에는 붙이지 않는다
  // — 루뱅 분할은 하루짜리고 `mergeCommunities`도 그날 엣지 위에서만 돌아서, 어제의
  // 사건과 오늘의 사건이 같다고 말할 근거가 이 코드베이스에 없다.
  //
  // 새 쿼리를 만들지 않는다. `fetchWordCountsFor`가 이미 단어를 지목해서 묻고
  // (그래서 1,000행 상한에 안 걸리고) 이미 캐시돼 있다. 분모도 이미 손에 있는
  // `headlinesByDate`이고, 그것은 `collected_dates`의 `count(*)`이지 응답의 합이
  // 아니다.
  useEffect(() => {
    if (!selectedWord || availableDates.length === 0) {
      setHistory([])
      return
    }
    let cancelled = false
    fetchWordCountsFor(availableDates, [selectedWord])
      .then((counts) => {
        if (cancelled) return
        setHistory(
          buildHistory(counts, headlinesByDate, availableDates, { endDate: selectedDate }),
        )
      })
      .catch(() => {
        // 급상승 표식과 같은 방식으로 삼킨다. 궤적이 없어도 헤드라인 목록은 그대로
        // 읽히고, 없는 편이 오류 페이지보다 낫다.
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedWord, selectedDate, availableDates, headlinesByDate])

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
  // The events the word clicked on the canvas belongs to. A bridging word gives
  // every event it touches — the same set focusWords lights on the canvas.
  //
  // Canvas and list deliberately light different things: the canvas lights a
  // word and its neighbours, which can cross an event boundary, while the list
  // states membership. Two different questions, so they are not reconciled.
  const relatedEvents = useMemo(
    () => (selectedWord ? eventsOf(eventGraph, selectedWord) : []),
    [eventGraph, selectedWord],
  )

  const rankedEvents = useMemo(
    () =>
      topEvents(eventGraph.events, eventCounts?.of === eventGraph ? eventCounts.counts : null, {
        limit: eventsExpanded ? Infinity : EVENT_LIST_LIMIT,
        // So that a word belonging to an event ranked below the list's five
        // still has a name, that event is appended as one more row. Lifting the
        // limit makes this a no-op by construction rather than by a branch.
        pinned: relatedEvents,
      }),
    [eventGraph, eventCounts, relatedEvents, eventsExpanded],
  )

  // A day holds 14 to 17 events and a category tab far fewer, so an expansion
  // carried across a change leaves the page at the previous view's height
  // showing a different view's content. eventGraph is the identity that moves on
  // both a date and a category change.
  useEffect(() => {
    setEventsExpanded(false)
  }, [eventGraph])


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

      {/* **가로 폭이 여기서 갈린다.** 산문은 자기 자로 재고 캔버스는 자기 자로
          잰다: 읽는 글줄은 길어져서 좋을 것이 없고, 그림은 넓을수록 선반이 한 줄에
          더 들어가 세로가 짧아진다. 그래서 `max-w-6xl`이 <main>에서 내려와 매스트헤드와
          오류 블록에 각각 붙고, 그래프만 자기 상자를 따로 받는다.

          CLAUDE.md의 "넓혀도 얻는 것이 없다"는 이 경우가 **아니다**. 그 기록은 고정된
          상자 **안에서** 단어를 옆으로 벌리는 것에 대한 것이고 — svg는 자기 크롭 크기로
          그려진 뒤 `max-w-full`로 축소되므로 벌린 만큼 그대로 작아진다 — 여기서는 상자
          자체가 커진다. 배치가 더 넓은 폭에서 돌므로 축소되는 몫이 줄고 선반이 더 들어간다. */}
      <main className="px-4 pt-6 pb-8 sm:px-6">
        <div className="mx-auto max-w-6xl">
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
          {/* 전체 보기에서만. 한 섹션 탭 위의 몫 차트는 아무것도 말하지 않는
              꽉 찬 원이다. 산문 쪽 폭에 두는 이유는 이것이 그날의 **수집**에
              대한 서술이지 캔버스의 일부가 아니기 때문이다. */}
          {selectedCategory === null && (
            <CategoryShare share={categoryShare} categories={categories} />
          )}
        </div>

        {error && (
          <div className="mx-auto max-w-6xl text-center">
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
            className={`mx-auto w-full max-w-[1600px] origin-top transition-transform duration-300 motion-reduce:transition-none ${
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
                  related={relatedEvents}
                  total={eventGraph.events.length}
                  expanded={eventsExpanded}
                  onToggle={() => setEventsExpanded((current) => !current)}
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
        history={history}
        onClose={() => {
          setSelectedWord(null)
          setSelectedEvent(null)
        }}
      />
    </div>
  )
}


export default App
