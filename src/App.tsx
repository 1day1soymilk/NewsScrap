// src/App.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CategoryShare } from './components/CategoryShare'
import { CategoryTabs } from './components/CategoryTabs'
import { EventList } from './components/EventList'
import { GraphSkeleton } from './components/GraphSkeleton'
import { HeadlinePanel } from './components/HeadlinePanel'
import type { DayHeadlines } from './components/HeadlinePanel'
import { KeywordGraph } from './components/KeywordGraph'
import { Masthead } from './components/Masthead'
import { WordSearch } from './components/WordSearch'
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
import { buildHistory, historyWindow } from './lib/history'
import { pickOpeningDate } from './lib/openingDate'
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
import type { Category, KeywordGraphData } from './lib/types'

const EMPTY_GRAPH: KeywordGraphData = { nodes: [], edges: [] }
const NO_SURGES: Map<string, Surge> = new Map()
const NO_EVENTS: EventGraph = { events: [], bridges: new Map() }
const NO_SHARE: CategoryShareRow[] = []
const NO_DATES: ReadonlySet<string> = new Set()
const EMPTY_DAY: DayHeadlines = { headlines: [], loading: false, error: null }
const NO_WORD_DAYS = { for: '', days: new Map<string, DayHeadlines>() }
const NO_HISTORY = { for: '', points: [] as HistoryPoint[] }

// A Louvain partition is carried around paired with the graph it came from,
// because it arrives from an effect that runs **after** the canvas has painted:
// for one frame, while a new day is first drawn, this Map still belongs to the
// previous one.
type Partition = { graph: KeywordGraphData; communities: Map<string, number> }

// 궤적은 단어와 창의 끝(화면의 날짜) 둘 다에 달려 있으므로 둘 다 신원에 들어간다.
function historyKey(word: string, date: string): string {
  return `${word}|${date}`
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
  // 헤드라인 패널에서 지금 펼쳐 놓은 날들. 같은 이유로 URL에 없다 — 그리고 **캔버스의
  // 날짜를 바꾸지 않는다**: 검색으로 닿은 단어가 날짜를 옮기지 않는 것과 같은 판단으로,
  // 읽던 화면이 발밑에서 움직이면 안 된다.
  //
  // 어느 상태에 대한 펼침인지를 `for`에 같이 들고 다닌다. 날짜/단어가 바뀌면 저절로
  // 무효가 되어 기본값으로 돌아가므로, 되돌리는 effect가 필요 없다 — effect로
  // 되돌리면 그 한 렌더 동안 이전 날짜가 유효해 보여서 지난 날의 요청이 한 번 나간다.
  //
  // **집합인 것과 기본이 빈 것이 둘 다 요점이다.** 날 하나를 문자열로 들면 같은 줄을
  // 다시 눌러도 값이 안 바뀌어 토글이 표현되지 않고, 전부 닫힌 상태를 만들 방법이
  // 없다. 그리고 기본이 비어 있으므로 단어를 눌러도 헤드라인 요청이 나가지 않는다 —
  // 읽고 싶은 날을 고르는 것은 읽는 사람이다.
  const [panelDates, setPanelDates] = useState<{ for: string; dates: Set<string> } | null>(null)
  const [graph, setGraph] = useState<KeywordGraphData>(EMPTY_GRAPH)
  const [categoryShare, setCategoryShare] = useState<CategoryShareRow[]>(NO_SHARE)
  const [surges, setSurges] = useState<Map<string, Surge>>(NO_SURGES)
  // 날짜별 목록. 어느 (단어, 섹션)에 대한 것인지를 함께 들고 다니는 것은 partition이
  // graph와, eventCounts가 eventGraph와 짝지어 다니는 것과 같은 이유다: 짝이 어긋난
  // 순간 통째로 비어야지, 다른 단어의 목록이 한 프레임 보여서는 안 된다. 그리고
  // 이 짝짓기가 없으면 닫았다 다시 연 날이 — 캐시에 이미 있는데도 — 한 프레임
  // "관련 헤드라인이 없습니다"를 번쩍인다.
  const [wordDays, setWordDays] = useState<{ for: string; days: Map<string, DayHeadlines> }>(
    NO_WORD_DAYS,
  )
  // 사건에는 날짜 축이 없다. 화면의 날짜 하나를 읽으므로 상태도 하나다.
  const [eventDay, setEventDay] = useState<DayHeadlines>(EMPTY_DAY)
  // 궤적도 **어느 단어의 것인지와 함께** 든다. 아직 안 온 것과 와서 비어 있는 것을
  // 구별하지 못하면, 단어를 누를 때마다 도착 전 한 박자 동안 화면의 날짜를 평평한
  // 목록으로 그리려고 요청을 한 번 내보내고 도착과 함께 그것이 사라져 깜빡인다.
  const [history, setHistory] = useState<{ for: string; points: HistoryPoint[] }>(NO_HISTORY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  // 오늘을 지나쳐 왔다는 사실을 화면에 적을 것인지. 두 조건이 다 필요하다: 화면의
  // 날이 오늘이 아니고, **오늘이 아직 열기에 얇을 것**. 두 번째가 없으면 저녁에
  // 옛 날짜를 보는 사람에게 "오늘은 아직 3,100건 수집 중"이라는 거짓말을 하게 된다.
  //
  // 판정은 `pickOpeningDate`를 그대로 다시 불러서 한다. 이 줄이 설명하는 것이 바로
  // 그 규칙의 판정이므로, 여기서 다른 식으로 물으면 설명과 행동이 어긋날 수 있다 —
  // `keyword_signals`를 다시 구현하지 않는 것과 같은 이유다.
  const untakenToday = useMemo(() => {
    const today = todayInSeoul()
    if (collectedDates.length === 0 || selectedDate === today) return null
    if (pickOpeningDate(collectedDates, today) === today) return null
    return { date: today, headlines: headlinesByDate.get(today) ?? null }
  }, [collectedDates, headlinesByDate, selectedDate])

  // A slug from a hand-edited or stale link that matches no section would leave
  // every tab unselected while the graph filtered on nothing — a state the UI
  // has no way to produce or to escape from.
  useEffect(() => {
    if (categories.length === 0 || selectedCategory === null) return
    if (!categories.some((category) => category.slug === selectedCategory)) {
      setSelectedCategory(null)
    }
  }, [categories, selectedCategory])

  // --- Which day the app opens on -------------------------------------------
  //
  // **Today is genuinely empty in the morning, and no amount of collecting
  // fixes that.** At 03:00 KST a day holds ~200 headlines and its pool of words
  // with `df >= 3` is 59-81, below the render cap of 70; not one Naver section
  // publishes 150 articles before 07:00. So with no `?date=` to go by the app
  // opens on the newest day that has filled up — `src/lib/openingDate.ts` holds
  // that rule and the measurements behind its threshold.
  //
  // **A link always wins.** A shared `?date=` is a claim about which day is
  // meant, and second-guessing it would make the link mean something different
  // for the sender and the receiver.

  const urlSynced = useRef(false)
  // Null when the URL named no date, which is the only case this rule applies
  // to. Read once, at mount, because the URL is rewritten from state below.
  const urlDateAtMount = useRef(stateFromUrl().date)
  const openingSettled = useRef(false)
  // What "no date" resolves to. `onPopState` reads it rather than calling
  // todayInSeoul() itself, so the two cannot disagree about the default.
  const openingDate = useRef(todayInSeoul())

  useEffect(() => {
    if (urlDateAtMount.current !== null || openingSettled.current) return
    if (collectedDates.length === 0) return
    openingSettled.current = true

    const opening = pickOpeningDate(collectedDates, todayInSeoul())
    openingDate.current = opening
    if (opening === selectedDate) return

    // **This move is still the app deciding what to open on, not navigation.**
    // Clearing the flag sends the next URL write back through replaceState, so
    // the reader does not get a Back button that undoes a choice they never
    // made — the same reasoning as the first write below.
    urlSynced.current = false
    setSelectedDate(opening)
  }, [collectedDates, selectedDate])

  // --- URL state ------------------------------------------------------------
  // history.pushState and popstate, rather than a router: there is one route.

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
      setSelectedDate(state.date ?? openingDate.current)
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
      setHistory(NO_HISTORY)
      return
    }
    let cancelled = false
    // PostgREST spells an unbounded date list `collected_date=in.(…)`, so the
    // fetch is bounded to the same window buildHistory would keep anyway —
    // historyWindow is what stops the two from being able to disagree.
    const dates = historyWindow(availableDates, selectedDate)
    const key = historyKey(selectedWord, selectedDate)
    fetchWordCountsFor(dates, [selectedWord])
      .then((counts) => {
        if (cancelled) return
        setHistory({
          for: key,
          points: buildHistory(counts, headlinesByDate, dates, { endDate: selectedDate }),
        })
      })
      .catch(() => {
        // 급상승 표식과 같은 방식으로 삼킨다. 궤적이 없어도 헤드라인 목록은 그대로
        // 읽히고, 없는 편이 오류 페이지보다 낫다. 실패도 **도착**이므로 `for`를
        // 채운다 — 그러지 않으면 목록이 영원히 도착을 기다리며 비어 있다.
        if (!cancelled) setHistory({ for: key, points: [] })
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


  // 검색으로 닿은 단어는 그날 그려진 70개 안에 없을 수 있다. 그래프가 아직 안
  // 왔을 때(nodes 0)는 아직 판단할 수 없으므로 false로 둔다 — 공유된 링크가
  // 그래프 도착 전에 "없는 단어"라고 불려서는 안 된다.
  const wordOffCanvas = useMemo(
    () =>
      selectedWord !== null &&
      graph.nodes.length > 0 &&
      !graph.nodes.some((node) => node.word === selectedWord),
    [graph.nodes, selectedWord],
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

  // 사건은 화면의 날짜 한 칸짜리 맵으로 넘긴다. 패널의 출처를 둘로 두지 않기 위해서다
  // — 구획을 쓰지 않는 경우는 사건이든 단어든 `activeDate` 한 칸을 읽는다.
  const eventDays = useMemo(() => new Map([[selectedDate, eventDay]]), [selectedDate, eventDay])

  // 패널 제목. 목록의 한 줄과 같은 규칙으로 자른다.
  const eventSubject = useMemo(() => {
    if (!activeEvent) return null
    const { shown, rest } = eventLabel(activeEvent.words)
    return rest > 0 ? `${shown.join(' · ')} 외 ${rest}` : shown.join(' · ')
  }, [activeEvent])

  // 패널이 지금 어느 날들을 펼쳐 놓았는가. **기본은 전부 닫힘**이고, 줄을 누르면
  // 그 날 하나가 토글된다. 캔버스는 움직이지 않는다.
  const panelKey = `${selectedWord ?? ''}|${selectedEvent ?? ''}|${selectedDate}`
  const openDates = useMemo(
    // 신원이 매 렌더 바뀌면 아래 effect가 매 렌더 돈다. 그래서 빈 경우는 상수 하나를
    // 돌려준다.
    () => (panelDates?.for === panelKey ? panelDates.dates : NO_DATES),
    [panelDates, panelKey],
  )
  const toggleDate = useCallback(
    (date: string) => {
      setPanelDates((current) => {
        const base = current?.for === panelKey ? current.dates : NO_DATES
        const next = new Set(base)
        if (!next.delete(date)) next.add(date)
        return { for: panelKey, dates: next }
      })
    },
    [panelKey],
  )

  // **"궤적이 도착했나"는 한 번만 묻는다.** 두 군데서 따로 물으면 한쪽을 지워도
  // 다른 쪽이 가려 주어, 지워도 안 깨지는 자리가 생긴다(실제로 뮤테이션으로 확인함).
  //
  // 도착 전의 빈 배열을 "그릴 줄이 없다"로 읽으면 두 가지가 함께 잘못된다: 단어를
  // 누를 때마다 화면의 날짜를 한 번 받아 버리고(전부 닫힌 채로 여는 규칙이 무너진다),
  // 그리고 도착 직전 한 프레임 동안 **앞 단어의** 날짜 줄이 새 단어 아래 그려진다.
  const historyReady =
    selectedWord !== null && history.for === historyKey(selectedWord, selectedDate)
  const historyPoints = historyReady ? history.points : NO_HISTORY.points

  // 사건의 헤드라인. 날짜 축이 없으므로 화면의 날짜 하나를 읽는다 — **그것은 데이터의
  // 성질이지 아직 안 만든 기능이 아니다**: 루뱅 분할이 하루짜리라 어제의 같은 사건
  // 이라는 것이 정의되지 않는다.
  useEffect(() => {
    // 다리 단어를 눌러도 열리는 것은 **그 단어의** 헤드라인이다. 두 사건의
    // 헤드라인을 합쳐 열면 그 단어가 왜 접점인지가 오히려 묻힌다.
    const eventWords = selectedWord ? null : (activeEvent?.words.map((w) => w.word) ?? null)
    if (!eventWords) {
      setEventDay(EMPTY_DAY)
      return
    }

    let cancelled = false
    const request = fetchHeadlinesForEvent(selectedDate, selectedCategory, eventWords)
    setEventDay({
      headlines: [],
      loading: !fetchHeadlinesForEvent.isReady(selectedDate, selectedCategory, eventWords),
      error: null,
    })
    request
      .then((data) => {
        if (!cancelled) setEventDay({ headlines: data, loading: false, error: null })
      })
      .catch((e) => {
        if (!cancelled) setEventDay({ headlines: [], loading: false, error: errorMessage(e) })
      })
    return () => {
      cancelled = true
    }
  }, [selectedWord, activeEvent, selectedDate, selectedCategory])

  // 단어의 헤드라인, **펼쳐 놓은 날마다 하나씩.**
  //
  // 여러 날을 한 요청으로 받지 않는다: 폭염은 아카이브 9일에 952건 / 명사행 973이라
  // 한 번에 받으면 PostgREST의 1,000행 캡에 앉아 말없이 잘린다. 하루씩 받는 것은 캡이
  // 구조적으로 못 걸리고, `fetchHeadlinesForWord`가 이미 날짜별로 캐시한다.
  const wantedDates = useMemo(() => {
    if (!selectedWord || !historyReady) return NO_DATES
    // 그릴 줄이 하나도 없으면 — 창 안 어느 날에도 그 단어가 없다 — 패널은 화면의
    // 날짜를 평평하게 그린다. 그때 필요한 하루가 이것이다.
    return historyPoints.some((point) => point.present) ? openDates : new Set([selectedDate])
  }, [selectedWord, historyReady, historyPoints, openDates, selectedDate])

  useEffect(() => {
    if (!selectedWord) {
      setWordDays(NO_WORD_DAYS)
      return
    }
    const key = `${selectedWord}|${selectedCategory ?? '*'}`
    let cancelled = false

    // 이미 받아 둔 날은 그대로 이어 쓴다. 매번 새 맵을 만들면 닫았다 다시 연 날이
    // 캐시 히트인데도 한 프레임 "관련 헤드라인이 없습니다"를 번쩍인다.
    //
    // **스켈레톤은 기다릴 것이 있을 때만** 올린다. 그 판정은 프로미스가 언제 풀리는
    // 지로 추측하지 않고 캐시에 직접 묻는다 — `loadGraph`가 같은 이유로 같은 모양을
    // 하고 있다.
    setWordDays((current) => {
      const held = current.for === key ? current.days : null
      const days = new Map<string, DayHeadlines>()
      for (const date of wantedDates) {
        days.set(
          date,
          held?.get(date) ?? {
            headlines: [],
            loading: !fetchHeadlinesForWord.isReady(date, selectedCategory, selectedWord),
            error: null,
          },
        )
      }
      return { for: key, days }
    })

    function settle(date: string, day: DayHeadlines) {
      if (cancelled) return
      setWordDays((current) => {
        if (current.for !== key || !current.days.has(date)) return current
        return { for: key, days: new Map(current.days).set(date, day) }
      })
    }

    for (const date of wantedDates) {
      fetchHeadlinesForWord(date, selectedCategory, selectedWord)
        .then((data) => settle(date, { headlines: data, loading: false, error: null }))
        .catch((e) => settle(date, { headlines: [], loading: false, error: errorMessage(e) }))
    }
    return () => {
      cancelled = true
    }
  }, [selectedWord, selectedCategory, wantedDates])

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
          {/* lg 아래에서는 워드마크와 검색창이 한 줄을 나눠 쓴다 — 이 래퍼가 없어서
              검색창이 CategoryTabs 아래 제 줄을 새로 차지하면 헤더가 세 줄이 되고,
              index.css의 --header-height(lg 아래 6.5rem)는 두 줄만 계산해 둔
              값이라 더 이상 실제 높이와 맞지 않는다 — 패널이 검색창 위에 겹친다.
              lg부터는 `contents`로 이 래퍼가 사라져 h1과 검색창이 CategoryTabs와
              나란히 한 줄이 된다. */}
          <div className="flex items-center justify-between gap-3 lg:contents">
            <h1 className="text-sm font-medium tracking-[0.2em] text-ink-muted uppercase">
              뉴스 스크랩
            </h1>
            <WordSearch
              onSelect={(word) => {
                // 단어 선택과 사건 선택은 상호배제다 — 캔버스에서 무엇이 살아 있는지
                // 읽을 수 없게 된다. 캔버스 클릭 핸들러와 같은 규칙.
                setSelectedEvent(null)
                setSelectedWord(word)
              }}
            />
          </div>
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
            today={untakenToday}
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
              // 검색으로 닿은 단어가 이 날 캔버스에 없으면(wordOffCanvas) 캔버스에는
              // 포커스할 대상이 없다 — null을 넘겨 아무것도 선택되지 않은 것처럼
              // 그리게 한다. 그러지 않으면 KeywordGraph의 이웃 집합이 빈 채로
              // selectedWord만 켜져서 모든 라벨이 0.1로 죽고 모든 엣지가 숨는다.
              // EventList가 이미 지키는 규칙과 같다 — "빈 집합은 아무것도 죽이지
              // 않는다". 패널은 그대로 열려 있고 헤드라인과 궤적도 그대로 보인다.
              selectedWord={wordOffCanvas ? null : selectedWord}
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
        days={selectedWord ? wordDays.days : eventDays}
        activeDate={selectedDate}
        categories={categories}
        history={historyPoints}
        openDates={openDates}
        onToggleDate={toggleDate}
        offCanvas={wordOffCanvas}
        onClose={() => {
          setSelectedWord(null)
          setSelectedEvent(null)
        }}
      />
    </div>
  )
}


export default App
