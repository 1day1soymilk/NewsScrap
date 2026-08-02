import { describe, expect, it } from 'vitest'
import { buildEvents, eventLabel, eventsOf, sameCommunities, topEvents } from './events'
import type { EventWord, NewsEvent } from './events'
import type { GraphEdge } from './types'

function w(word: string, count: number): EventWord {
  return { word, count }
}

function e(a: string, b: string): GraphEdge {
  return { a, b, cooc: 3, npmi: 0.7 }
}

// Louvain's output, handed in rather than computed: buildEvents takes the
// partition the canvas actually used, so these tests name it directly.
function communities(groups: string[][]): Map<string, number> {
  const map = new Map<string, number>()
  groups.forEach((group, id) => group.forEach((word) => map.set(word, id)))
  return map
}

describe('buildEvents — 합치기', () => {
  it('엣지 2개로 이어진 두 커뮤니티를 하나로 본다', () => {
    const words = [w('김민석', 10), w('정청래', 8), w('최민희', 6), w('최고위원', 4)]
    const { events } = buildEvents(
      words,
      [e('김민석', '정청래'), e('최민희', '최고위원'), e('김민석', '최민희'), e('정청래', '최고위원')],
      communities([['김민석', '정청래'], ['최민희', '최고위원']]),
    )

    expect(events).toHaveLength(1)
    expect(events[0].words.map((x) => x.word)).toEqual(['김민석', '정청래', '최민희', '최고위원'])
  })

  it('엣지 1개짜리는 합치지 않는다', () => {
    // 2026-08-01의 민주당–한동훈. 닿아 있지만 민주당 전당대회와 국민의힘
    // 지도부는 다른 사건이고, 문턱을 1로 내리면 이 둘이 붙는다.
    const words = [w('민주당', 10), w('곽상언', 8), w('한동훈', 6), w('장동혁', 4)]
    const { events } = buildEvents(
      words,
      [e('민주당', '곽상언'), e('한동훈', '장동혁'), e('민주당', '한동훈')],
      communities([['민주당', '곽상언'], ['한동훈', '장동혁']]),
    )

    expect(events).toHaveLength(2)
  })

  it('합치기는 전이적이다', () => {
    // 2026-08-02: 전당대회 묶음이 최민희 쪽과 5개, 순회경선 쪽과 2개로 붙어
    // 셋이 하나가 된다. 순회경선과 최민희 사이에는 직접 엣지가 없어도 된다.
    const words = [w('A1', 9), w('A2', 8), w('B1', 7), w('B2', 6), w('C1', 5), w('C2', 4)]
    const { events } = buildEvents(
      words,
      [
        e('A1', 'A2'), e('B1', 'B2'), e('C1', 'C2'),
        e('A1', 'B1'), e('A2', 'B2'),
        e('A1', 'C1'), e('A2', 'C2'),
      ],
      communities([['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']]),
    )

    expect(events).toHaveLength(1)
    expect(events[0].words).toHaveLength(6)
  })

  it('혼자인 커뮤니티는 사건이 아니다', () => {
    // findClusters가 싱글턴을 버리는 것과 같은 컷. 이것이 다리 계산에서
    // "자기 사건 밖" 자체를 정의할 수 없는 단어의 정체이기도 하다.
    const { events } = buildEvents(
      [w('폭염', 9), w('열대야', 7), w('까마귀', 5)],
      [e('폭염', '열대야')],
      communities([['폭염', '열대야'], ['까마귀']]),
    )

    expect(events).toHaveLength(1)
    expect(events[0].words.map((x) => x.word)).toEqual(['폭염', '열대야'])
  })

  it('사건 안의 단어는 기사 수 내림차순, 동수면 단어순이다', () => {
    // 2026-07-31 하루에만 두 번 걸린다 (노무현·정청래 둘 다 8건,
    // 삼전닉스·코스닥 둘 다 6건). 클라이언트 정렬이므로 안정 정렬에 기대지
    // 않고 단어를 명시적 2차 키로 쓴다.
    const { events } = buildEvents(
      [w('정청래', 8), w('김민석', 12), w('노무현', 8)],
      [e('김민석', '정청래'), e('정청래', '노무현')],
      communities([['김민석', '정청래', '노무현']]),
    )

    expect(events[0].words.map((x) => x.word)).toEqual(['김민석', '노무현', '정청래'])
  })

  it('엣지가 없으면 사건도 없다', () => {
    const { events, bridges } = buildEvents(
      [w('폭염', 9), w('까마귀', 5)],
      [],
      communities([['폭염'], ['까마귀']]),
    )

    expect(events).toEqual([])
    expect(bridges.size).toBe(0)
  })
})

describe('buildEvents — 다리', () => {
  it('합쳐지지 않은 쌍의 양끝이 다리이고, 자기 사건도 목록에 든다', () => {
    const words = [w('민주당', 10), w('곽상언', 8), w('한동훈', 6), w('장동혁', 4)]
    const { events, bridges } = buildEvents(
      words,
      [e('민주당', '곽상언'), e('한동훈', '장동혁'), e('민주당', '한동훈')],
      communities([['민주당', '곽상언'], ['한동훈', '장동혁']]),
    )

    const democrats = events.findIndex((ev) => ev.words.some((x) => x.word === '민주당'))
    const opposition = events.findIndex((ev) => ev.words.some((x) => x.word === '한동훈'))

    expect(bridges.get('민주당')).toEqual([democrats, opposition].sort((a, b) => a - b))
    expect(bridges.get('한동훈')).toEqual([democrats, opposition].sort((a, b) => a - b))
    expect(bridges.has('곽상언')).toBe(false)
    expect(bridges.has('장동혁')).toBe(false)
  })

  it('합쳐진 쌍의 양끝은 다리가 아니다', () => {
    // 정의상 그렇다 — 2개 이상으로 이어진 쌍은 이미 한 사건이므로 그 엣지는
    // 자기 사건 밖으로 나가지 않는다.
    const { bridges } = buildEvents(
      [w('김민석', 10), w('정청래', 8), w('최민희', 6), w('최고위원', 4)],
      [e('김민석', '정청래'), e('최민희', '최고위원'), e('김민석', '최민희'), e('정청래', '최고위원')],
      communities([['김민석', '정청래'], ['최민희', '최고위원']]),
    )

    expect(bridges.size).toBe(0)
  })

  it('제3의 커뮤니티를 거쳐 한 사건이 된 쌍의 엣지도 다리가 아니다', () => {
    // A와 C는 엣지 1개로만 닿아 있지만 둘 다 B를 통해 한 사건이 되었다.
    // 다리 판정은 쌍의 엣지 수가 아니라 **최종 사건 소속**으로 한다.
    const { events, bridges } = buildEvents(
      [w('A1', 9), w('A2', 8), w('B1', 7), w('B2', 6), w('C1', 5), w('C2', 4)],
      [
        e('A1', 'A2'), e('B1', 'B2'), e('C1', 'C2'),
        e('A1', 'B1'), e('A2', 'B2'),
        e('B1', 'C1'), e('B2', 'C2'),
        e('A1', 'C1'),
      ],
      communities([['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']]),
    )

    expect(events).toHaveLength(1)
    expect(bridges.size).toBe(0)
  })

  it('세 사건에 닿는 단어는 셋을 다 돌려준다', () => {
    const { bridges } = buildEvents(
      [w('허브', 12), w('A2', 8), w('B1', 7), w('B2', 6), w('C1', 5), w('C2', 4)],
      [e('허브', 'A2'), e('B1', 'B2'), e('C1', 'C2'), e('허브', 'B1'), e('허브', 'C1')],
      communities([['허브', 'A2'], ['B1', 'B2'], ['C1', 'C2']]),
    )

    expect(bridges.get('허브')).toHaveLength(3)
  })

  it('싱글턴 커뮤니티의 단어는 다리가 아니고, 그 엣지도 다리를 만들지 않는다', () => {
    // 속한 사건이 없으므로 "자기 사건 밖으로 나가는 엣지"를 정의할 수 없다.
    // 양끝 중 하나라도 사건에 속하지 않으면 그 엣지는 다리가 아니다.
    const { bridges } = buildEvents(
      [w('폭염', 9), w('열대야', 7), w('외톨이', 5)],
      [e('폭염', '열대야'), e('폭염', '외톨이')],
      communities([['폭염', '열대야'], ['외톨이']]),
    )

    expect(bridges.size).toBe(0)
  })
})

describe('topEvents', () => {
  const words = [w('트럼프', 30), w('이스라엘', 25), w('폭염', 40), w('양산', 20)]
  const edges = [e('트럼프', '이스라엘'), e('폭염', '양산')]
  const partition = communities([['트럼프', '이스라엘'], ['폭염', '양산']])

  it('합계가 아니라 넘겨받은 중복 제거 기사 수로 순위를 매긴다', () => {
    // 2026-08-01이 이 모양이었다. countSum은 트럼프 55, 폭염 60이므로 합계로는
    // 폭염이 이긴다. 중복 제거 수를 51 대 40으로 주면 순서가 뒤집히고, 그
    // 뒤집힘이 이 함수가 카운트를 인자로 받는 이유 전부다.
    const { events } = buildEvents(words, edges, partition)
    const trump = events.findIndex((ev) => ev.words.some((x) => x.word === '트럼프'))
    const heat = events.findIndex((ev) => ev.words.some((x) => x.word === '폭염'))

    const counts: number[] = []
    counts[trump] = 51
    counts[heat] = 40

    const ranked = topEvents(events, counts)
    expect(ranked[0].event.words[0].word).toBe('트럼프')
    expect(ranked[0].headlines).toBe(51)
    expect(ranked[1].headlines).toBe(40)
  })

  it('카운트가 없으면 합계 순서로 떨어지고 기사 수는 null이다', () => {
    const { events } = buildEvents(words, edges, partition)
    const ranked = topEvents(events, null)

    expect(ranked[0].event.words[0].word).toBe('폭염')
    expect(ranked[0].headlines).toBeNull()
  })

  it('상위 5개로 자른다', () => {
    const many: EventWord[] = []
    const pairs: GraphEdge[] = []
    const groups: string[][] = []
    for (let i = 0; i < 8; i++) {
      many.push(w(`a${i}`, 10 - i), w(`b${i}`, 9 - i))
      pairs.push(e(`a${i}`, `b${i}`))
      groups.push([`a${i}`, `b${i}`])
    }
    const { events } = buildEvents(many, pairs, communities(groups))

    expect(events).toHaveLength(8)
    expect(topEvents(events, null)).toHaveLength(5)
  })

  it('5개가 안 되면 있는 만큼, 0개면 빈 배열', () => {
    const { events } = buildEvents(words, edges, partition)
    expect(topEvents(events, null)).toHaveLength(2)
    expect(topEvents([], null)).toEqual([])
  })

  it('카운트 배열이 사건 수보다 짧으면 전부 없는 것으로 본다', () => {
    // 상위 N개 사건에만 카운트를 요청하는 실수 — 계획서가 명시적으로 되짚는
    // 바로 그 안티패턴 — 를 흉내낸 배열. 절반만 채워진 배열이 실제 수와
    // countSum을 같은 비교에 섞이게 두면 안 되므로, 이 경우 전부 countSum
    // 순서로 떨어지고 headlines는 모두 null이어야 한다.
    const { events } = buildEvents(words, edges, partition)
    const short: number[] = [51] // 사건은 2개인데 배열 길이는 1

    const ranked = topEvents(events, short)

    expect(ranked[0].event.words[0].word).toBe('폭염')
    expect(ranked.every((r) => r.headlines === null)).toBe(true)
  })

  it('길이는 맞아도 구멍이 있으면 전부 없는 것으로 본다', () => {
    const { events } = buildEvents(words, edges, partition)
    const trump = events.findIndex((ev) => ev.words.some((x) => x.word === '트럼프'))
    const holed: number[] = []
    holed[trump] = 51 // 다른 사건의 자리는 비워 둔다
    holed.length = events.length // 길이는 사건 수와 정확히 같다

    const ranked = topEvents(events, holed)

    expect(ranked[0].event.words[0].word).toBe('폭염')
    expect(ranked.every((r) => r.headlines === null)).toBe(true)
  })
})

describe('eventsOf', () => {
  it('멤버 단어는 자기 사건 하나를 돌려준다', () => {
    const graph = buildEvents(
      [w('폭염', 9), w('열대야', 7), w('트럼프', 6), w('하마스', 5)],
      [e('폭염', '열대야'), e('트럼프', '하마스')],
      communities([['폭염', '열대야'], ['트럼프', '하마스']]),
    )
    const heat = graph.events.findIndex((ev) => ev.words.some((x) => x.word === '폭염'))

    expect(eventsOf(graph, '열대야')).toEqual([heat])
  })

  it('다리 단어는 닿는 사건을 전부 돌려준다 — bridges가 말하는 그대로', () => {
    // 캔버스의 focusWords가 다리 단어에 대해 켜는 사건과 같은 집합이어야 한다.
    // 목록이 그보다 좁게 밝히면 다리가 다리로 보이지 않는다.
    const graph = buildEvents(
      [w('민주당', 10), w('곽상언', 8), w('한동훈', 6), w('장동혁', 4)],
      [e('민주당', '곽상언'), e('한동훈', '장동혁'), e('민주당', '한동훈')],
      communities([['민주당', '곽상언'], ['한동훈', '장동혁']]),
    )

    expect(eventsOf(graph, '민주당')).toEqual(graph.bridges.get('민주당'))
    expect(eventsOf(graph, '민주당')).toHaveLength(2)
  })

  it('사건에 속하지 않는 단어는 빈 배열이다', () => {
    // 하루 70개 중 20개는 엣지가 하나도 없다. 오류가 아니라 그 단어가 어떤
    // 이야기의 일부도 아니라는 뜻이고, 목록은 아무 행도 밝히지 않는다.
    const graph = buildEvents(
      [w('폭염', 9), w('열대야', 7), w('외톨이', 5)],
      [e('폭염', '열대야')],
      communities([['폭염', '열대야'], ['외톨이']]),
    )

    expect(eventsOf(graph, '외톨이')).toEqual([])
    expect(eventsOf(graph, '없는단어')).toEqual([])
  })
})

describe('topEvents — pinned', () => {
  // 사건 8개, countSum이 i에 대해 단조 감소하므로 랭킹은 i 순서다.
  function manyEvents() {
    const many: EventWord[] = []
    const pairs: GraphEdge[] = []
    const groups: string[][] = []
    for (let i = 0; i < 8; i++) {
      many.push(w(`a${i}`, 10 - i), w(`b${i}`, 9 - i))
      pairs.push(e(`a${i}`, `b${i}`))
      groups.push([`a${i}`, `b${i}`])
    }
    return buildEvents(many, pairs, communities(groups)).events
  }

  const indexOf = (events: NewsEvent[], word: string) =>
    events.findIndex((ev) => ev.words.some((x) => x.word === word))

  it('상위 밖의 사건을 pin하면 목록 끝에 한 줄 붙는다', () => {
    const events = manyEvents()
    const ranked = topEvents(events, null, { pinned: [indexOf(events, 'a7')] })

    expect(ranked).toHaveLength(6)
    expect(ranked[5].event.words[0].word).toBe('a7')
  })

  it('이미 상위에 있는 사건을 pin해도 중복되지 않는다', () => {
    const events = manyEvents()
    const ranked = topEvents(events, null, { pinned: [indexOf(events, 'a1')] })

    expect(ranked).toHaveLength(5)
    expect(ranked.filter((r) => r.event.words[0].word === 'a1')).toHaveLength(1)
  })

  it('여러 개를 pin하면 랭킹 순서대로 붙는다', () => {
    const events = manyEvents()
    const ranked = topEvents(events, null, {
      pinned: [indexOf(events, 'a7'), indexOf(events, 'a5')],
    })

    expect(ranked.slice(5).map((r) => r.event.words[0].word)).toEqual(['a5', 'a7'])
  })

  it('pin은 잘리는 쪽의 상한을 늘리지 않는다', () => {
    const events = manyEvents()
    const ranked = topEvents(events, null, { pinned: [indexOf(events, 'a7')] })

    // 앞의 다섯은 여전히 랭킹 상위 다섯 그대로다.
    expect(ranked.slice(0, 5).map((r) => r.event.words[0].word)).toEqual([
      'a0', 'a1', 'a2', 'a3', 'a4',
    ])
  })
})

describe('eventLabel', () => {
  it('4개까지는 그대로 보이고 외 N이 붙지 않는다', () => {
    expect(eventLabel([w('가', 4), w('나', 3), w('다', 2), w('라', 1)])).toEqual({
      shown: ['가', '나', '다', '라'],
      rest: 0,
    })
  })

  it('넘으면 앞의 4개와 나머지 수를 돌려준다', () => {
    const words = ['가', '나', '다', '라', '마', '바', '사'].map((x, i) => w(x, 10 - i))
    expect(eventLabel(words)).toEqual({ shown: ['가', '나', '다', '라'], rest: 3 })
  })
})

describe('sameCommunities', () => {
  it('내용이 같으면 참이다', () => {
    expect(sameCommunities(communities([['가', '나']]), communities([['가', '나']]))).toBe(true)
  })

  it('배정이 다르거나 크기가 다르면 거짓이다', () => {
    expect(sameCommunities(communities([['가', '나']]), communities([['가'], ['나']]))).toBe(false)
    expect(sameCommunities(communities([['가', '나']]), communities([['가']]))).toBe(false)
  })
})
