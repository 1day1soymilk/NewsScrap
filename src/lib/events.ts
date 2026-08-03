// src/lib/events.ts
//
// 하루를 사건 목록으로 읽는 산술. 캔버스와 무관하고 d3에 닿지 않으므로
// graphLayout.ts가 아니라 여기 있다 — 거기 넣으면 레이아웃을 돌리지 않고는
// 테스트할 수 없어진다.
//
// 입력의 세 번째 인자인 커뮤니티 배정은 **캔버스가 실제로 쓴 루뱅 분할**이고,
// 여기서 다시 계산하지 않는다. 손으로 베낀 두 번째 사본을 재는 것은 이
// 저장소가 이미 두 번 당한 함정이다.

import type { GraphEdge } from './types'

export interface EventWord {
  word: string
  count: number
}

export interface NewsEvent {
  /** 멤버 단어. 기사 수 내림차순, 동수면 단어순. */
  words: EventWord[]
  /**
   * EventGraph.events 안의 자리. 다리 맵이 가리키는 신원이다 — 화면에 보이는
   * 목록은 중복 제거 카운트로 다시 정렬된 다른 순서이므로 그쪽을 쓸 수 없다.
   */
  index: number
  /**
   * 멤버들의 count 합. **사건의 기사 수가 아니다** — 한 기사가 두 멤버를 물면
   * 두 번 세어지고, 2026-08-02의 13단어 사건에서는 2.22배가 된다. 카운트 RPC가
   * 실패했을 때의 대체 순서로만 쓰고 화면에 내보내지 않는다.
   */
  countSum: number
}

export interface EventGraph {
  /** 합쳐진 사건 전부. 잘려 있지 않다 — 다리는 이 전체에 대해 계산된다. */
  events: NewsEvent[]
  /** 다리 단어 → 그 단어가 닿는 사건 인덱스들(오름차순, 자기 사건 포함). */
  bridges: Map<string, number[]>
}

export interface TopEventsOptions {
  /** How many rows the list holds. Defaults to 5. */
  limit?: number
  /**
   * Indices of events that must appear in the list whatever their rank, so that
   * a word clicked on the canvas still names its event when that event ranks
   * below the cut.
   */
  pinned?: readonly number[]
}

export interface RankedEvent {
  event: NewsEvent
  /** 중복 제거된 기사 수. 카운트 RPC가 실패하면 null이고 화면은 자리를 비운다. */
  headlines: number | null
}

// 루뱅 커뮤니티 두 개가 이만큼의 엣지로 이어져 있으면 목록에서 하나로 본다.
//
// 1이 아닌 이유: 2026-08-01의 민주당–한동훈이 엣지 하나로 붙어 있고, 민주당
// 전당대회와 국민의힘 지도부는 다른 사건이다. 3이 아닌 이유: 2026-08-02의
// 순회경선·명청대전이 엣지 2개로 붙어 있고 그것은 전당대회 사건의 일부라,
// 3으로 올리면 그날 최대 기사가 다시 쪼개진다.
const MERGE_MIN_EDGES = 2

// 목록의 길이. 문턱이 아니라 순위다 — 비율로 자르면 아무것도 가리키지 못한다는
// 것은 surgeLimitFor가 이미 측정한 것과 같은 이야기다. 합쳐진 뒤 하루의 사건은
// 14~17개이므로 상위 5개는 3분의 1이고, 잘려 나가는 꼬리는 대부분 캔버스에서
// 이미 선으로 이어진 채 붙어 있는 2단어 쌍이다.
//
// Exported so App.tsx can name it when it lifts the limit, rather than keeping a
// second copy of the number.
export const EVENT_LIST_LIMIT = 5

// 목록 한 줄에 보이는 단어 수. 세 날 통틀어 이 상한에 걸리는 것은 07-31의
// 트럼프 묶음(7단어)과 08-02의 전당대회(13단어)뿐이다.
const LABEL_WORDS = 4

/**
 * 루뱅 커뮤니티를 사건으로 합친다. 단어 → 사건 id.
 *
 * 혼자인 커뮤니티는 사건이 아니므로 **맵에서 빠진다.** 그런 단어에는 "자기 사건
 * 밖"이라는 것이 정의되지 않으니 다리도 될 수 없고, 캔버스 쪽에서도 자기 구역을
 * 받을 것이 없다.
 *
 * 목록과 캔버스가 **둘 다 이걸 부른다.** 캔버스의 응집력이 날것의 커뮤니티를
 * 당기고 목록은 합쳐진 사건을 세던 시절에는, 목록이 하나라고 부르는 이야기를
 * 캔버스가 두 덩어리로 쪼개 놓고 있었다. MERGE_MIN_EDGES의 사본이 하나여야
 * 하는 것은 그 다음 문제고, 먼저 **같은 답을 봐야 한다**는 것이 이 함수가
 * 있는 이유다.
 */
export function mergeCommunities(
  words: readonly EventWord[],
  edges: readonly GraphEdge[],
  communities: Map<string, number>,
): Map<string, number> {
  const size = new Map<number, number>()
  for (const word of words) {
    const id = communities.get(word.word)
    if (id === undefined) continue
    size.set(id, (size.get(id) ?? 0) + 1)
  }

  const communityOf = new Map<string, number>()
  for (const word of words) {
    const id = communities.get(word.word)
    if (id !== undefined && (size.get(id) ?? 0) > 1) communityOf.set(word.word, id)
  }

  // 서로 다른 두 커뮤니티를 잇는 엣지를 쌍마다 센다.
  const between = new Map<string, number>()
  for (const edge of edges) {
    const a = communityOf.get(edge.a)
    const b = communityOf.get(edge.b)
    if (a === undefined || b === undefined || a === b) continue
    between.set(pairKey(a, b), (between.get(pairKey(a, b)) ?? 0) + 1)
  }

  // 유니온-파인드. 전이성은 여기서 공짜로 나온다 — 2026-08-02의 정치 커뮤니티
  // 셋은 서로 다른 두 쌍을 통해 한 사건이 된다.
  const parent = new Map<number, number>()
  for (const id of size.keys()) parent.set(id, id)

  function find(id: number): number {
    const up = parent.get(id)
    if (up === undefined || up === id) return id
    const root = find(up)
    parent.set(id, root)
    return root
  }

  // 키 순으로 돌린다: 합치는 순서가 Postgres가 엣지를 돌려준 순서에 따라
  // 달라지면 같은 날이 두 번 다르게 그려진다.
  for (const key of [...between.keys()].sort()) {
    if ((between.get(key) ?? 0) < MERGE_MIN_EDGES) continue
    const [a, b] = key.split(':').map(Number)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb))
  }

  const eventOf = new Map<string, number>()
  for (const word of words) {
    const id = communityOf.get(word.word)
    if (id === undefined) continue
    eventOf.set(word.word, find(id))
  }
  return eventOf
}

export function buildEvents(
  words: EventWord[],
  edges: GraphEdge[],
  communities: Map<string, number>,
): EventGraph {
  const merged = mergeCommunities(words, edges, communities)

  const members = new Map<number, EventWord[]>()
  for (const word of words) {
    const root = merged.get(word.word)
    if (root === undefined) continue
    const group = members.get(root)
    if (group) group.push(word)
    else members.set(root, [word])
  }

  const events: NewsEvent[] = [...members.values()]
    .map((group) => {
      const sorted = [...group].sort(
        (a, b) => b.count - a.count || a.word.localeCompare(b.word),
      )
      return {
        words: sorted,
        index: 0,
        countSum: sorted.reduce((sum, word) => sum + word.count, 0),
      }
    })
    // 대체 순서일 뿐이다 — topEvents가 중복 제거 카운트로 다시 매긴다. 동수는
    // findClusters와 같이 첫 단어로 깬다.
    .sort(
      (a, b) => b.countSum - a.countSum || a.words[0].word.localeCompare(b.words[0].word),
    )
    .map((event, index) => ({ ...event, index }))

  const eventOf = new Map<string, number>()
  for (const event of events) {
    for (const word of event.words) eventOf.set(word.word, event.index)
  }

  // 다리는 **자기 사건 밖으로 엣지를 가진 단어**다. 쌍의 엣지 수가 아니라 최종
  // 소속으로 판정하는 것이 중요하다: 합치기가 거절한 쌍이라도 제3의 커뮤니티를
  // 거쳐 한 사건이 되었을 수 있고, 그러면 다리가 아니다.
  const bridges = new Map<string, number[]>()
  function touch(word: string, index: number): void {
    const held = bridges.get(word)
    if (!held) bridges.set(word, [index])
    else if (!held.includes(index)) held.push(index)
  }

  for (const edge of edges) {
    const a = eventOf.get(edge.a)
    const b = eventOf.get(edge.b)
    if (a === undefined || b === undefined || a === b) continue
    touch(edge.a, a)
    touch(edge.a, b)
    touch(edge.b, a)
    touch(edge.b, b)
  }
  for (const indices of bridges.values()) indices.sort((x, y) => x - y)

  return { events, bridges }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

// headlines가 events와 완전히 맞물려 있을 때만 참이다: null이 아니고, 길이가
// events와 같고, 모든 event.index 자리가 채워져 있어야 한다. 하나라도 어긋나면
// (짧은 배열이든, 길이는 맞지만 구멍이 있든) topEvents는 실제 수를 전혀 쓰지
// 않는다 — 절반만 채워진 배열이 실제 수와 countSum을 같은 비교 안에서 섞이게
// 두는 것이 이 함수가 카운트를 인자로 받는 이유 자체를 무너뜨리기 때문이다.
function fullyAligned(events: NewsEvent[], headlines: number[] | null): headlines is number[] {
  if (headlines === null) return false
  if (headlines.length !== events.length) return false
  return events.every((event) => headlines[event.index] !== undefined)
}

// 중복 제거된 기사 수로 순위를 매기고 자른다.
//
// 이 함수가 카운트를 인자로 받고 스스로 세지 않는 것은 CLAUDE.md의 규칙과 같은
// 이유다 — computeSurges가 분모를 넘겨받는 것과 같다. 멤버 카운트를 더해
// 순위를 매기면 사건마다 다른 배율로 부풀고 순서가 뒤집힌다: 2026-08-01의
// 실제 1위는 트럼프(합계 73 / 실제 51)가 아니라 폭염(69 / 61)이다.
export function topEvents(
  events: NewsEvent[],
  headlines: number[] | null,
  { limit = EVENT_LIST_LIMIT, pinned = [] }: TopEventsOptions = {},
): RankedEvent[] {
  // 카운트는 전부 있거나 전부 없다(RPC 한 번)는 것은 호출자의 관례일 뿐이고,
  // 이 함수는 그 관례를 믿지 않는다. fullyAligned가 배열 전체가 채워져
  // 있는지 확인하며, 어긋나면 counts는 null로 떨어져 아래 map이 모든 사건에
  // countSum을 쓰게 된다 — 실제 수와 합계가 한 비교 안에서 섞이는 일은 이
  // 함수 자체가 막는다.
  const counts = fullyAligned(events, headlines) ? headlines : null
  const ranked = events
    .map((event) => ({ event, headlines: counts?.[event.index] ?? null }))
    .sort(
      (a, b) =>
        (b.headlines ?? b.event.countSum) - (a.headlines ?? a.event.countSum) ||
        a.event.words[0].word.localeCompare(b.event.words[0].word),
    )

  const shown = ranked.slice(0, limit)
  // An event pushed past the cut still gets a name when it is the one being
  // looked at. The ranked side keeps its limit and the event is **appended** —
  // inserting it would let something that is not a rank pose as one.
  const held = new Set(shown.map((r) => r.event.index))
  for (const entry of ranked) {
    if (held.has(entry.event.index) || !pinned.includes(entry.event.index)) continue
    shown.push(entry)
    held.add(entry.event.index)
  }
  return shown
}

// The events a word belongs to. For a bridging word that is every event it
// touches, which has to be the same set focusWords lights on the canvas. A word
// belonging to no event — 20 of the 70 drawn hold no edge — gives an empty array.
//
// Reads only the partition buildEvents produced. Recomputing membership here
// would be the same trap as hand-copying keyword_signals.
export function eventsOf(graph: EventGraph, word: string): number[] {
  const bridged = graph.bridges.get(word)
  if (bridged) return bridged
  const index = graph.events.findIndex((event) => event.words.some((x) => x.word === word))
  return index === -1 ? [] : [index]
}

// 목록 한 줄에 보일 단어와, 가려진 나머지 수.
export function eventLabel(
  words: EventWord[],
  max: number = LABEL_WORDS,
): { shown: string[]; rest: number } {
  return {
    shown: words.slice(0, max).map((word) => word.word),
    rest: Math.max(0, words.length - max),
  }
}

// 레이아웃은 폭에 반응하므로 커뮤니티 배정이 리사이즈마다 새 Map으로 올라온다.
// 값은 바뀌지 않으므로(루뱅은 위상만 본다) 내용을 비교해 재요청을 막는다.
export function sameCommunities(
  a: Map<string, number>,
  b: Map<string, number>,
): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [word, id] of a) {
    if (b.get(word) !== id) return false
  }
  return true
}
