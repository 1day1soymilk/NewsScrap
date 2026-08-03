import { describe, expect, it } from 'vitest'
import { isPlanar, nearPlanarPositions, planarPositions, skewness, type PlanarEdge } from './planar'

function edges(pairs: string): PlanarEdge[] {
  return pairs
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [a, b] = pair.split('-')
      return { a, b }
    })
}

function nodesOf(list: PlanarEdge[]): string[] {
  return [...new Set(list.flatMap((e) => [e.a, e.b]))].sort()
}

/** 완전그래프 K_n. */
function complete(n: number): PlanarEdge[] {
  const out: PlanarEdge[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) out.push({ a: `v${i}`, b: `v${j}` })
  }
  return out
}

/** 완전이분그래프 K_{m,n}. */
function bipartite(m: number, n: number): PlanarEdge[] {
  const out: PlanarEdge[] = []
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) out.push({ a: `a${i}`, b: `b${j}` })
  }
  return out
}

describe('isPlanar', () => {
  it('빈 그래프와 한 점은 평면이다', () => {
    expect(isPlanar([], [])).toBe(true)
    expect(isPlanar(['가'], [])).toBe(true)
  })

  it('나무는 평면이다', () => {
    const list = edges('가-나 가-다 가-라 나-마 나-바')
    expect(isPlanar(nodesOf(list), list)).toBe(true)
  })

  it('K4는 평면이다', () => {
    const list = complete(4)
    expect(isPlanar(nodesOf(list), list)).toBe(true)
  })

  it('K5는 평면이 아니다', () => {
    // 쿠라토프스키의 두 금지 그래프 중 하나. 간선 10개, 3n−6 = 9이므로
    // 오일러 상한만으로도 걸린다.
    const list = complete(5)
    expect(isPlanar(nodesOf(list), list)).toBe(false)
  })

  it('K5에서 간선 하나를 빼면 평면이다', () => {
    const list = complete(5).slice(1)
    expect(isPlanar(nodesOf(list), list)).toBe(true)
  })

  it('K3,3은 평면이 아니다', () => {
    // 나머지 한 금지 그래프. 간선 9개에 꼭짓점 6개라 3n−6 = 12 > 9이므로
    // **오일러 상한으로는 안 걸린다** — 판정이 진짜로 위상을 보는지가 여기서 갈린다.
    const list = bipartite(3, 3)
    expect(isPlanar(nodesOf(list), list)).toBe(false)
  })

  it('K3,3에서 간선 하나를 빼면 평면이다', () => {
    const list = bipartite(3, 3).slice(1)
    expect(isPlanar(nodesOf(list), list)).toBe(true)
  })

  it('페테르센 그래프는 평면이 아니다', () => {
    // 이 시험이 제일 중요하다. 꼭짓점 10개에 간선 15개라 3n−6 = 24로 상한에서
    // 한참 멀고, K5도 K3,3도 **부분그래프로 품고 있지 않다**(세분으로만 품는다).
    // 간선 수를 세거나 부분그래프를 찾는 얕은 구현은 여기서 평면이라고 답한다.
    const list = edges(`
      o0-o1 o1-o2 o2-o3 o3-o4 o4-o0
      i0-i2 i2-i4 i4-i1 i1-i3 i3-i0
      o0-i0 o1-i1 o2-i2 o3-i3 o4-i4
    `)
    expect(isPlanar(nodesOf(list), list)).toBe(false)
  })

  it('연결 요소가 여럿이어도 각각을 본다', () => {
    // 한 덩어리가 평면이 아니면 전체가 평면이 아니고, 다 평면이면 전체가 평면이다.
    const planar = edges('가-나 나-다 다-가')
    const notPlanar = complete(5)
    expect(isPlanar(nodesOf(planar), planar)).toBe(true)
    expect(isPlanar([...nodesOf(planar), ...nodesOf(notPlanar)], [...planar, ...notPlanar])).toBe(
      false,
    )
  })

  it('자기 자신으로 가는 선과 중복된 선은 평면성을 바꾸지 않는다', () => {
    // 이 저장소의 엣지는 keyword_graph가 주는 것이라 둘 다 나올 일이 없지만,
    // 판정이 그것 때문에 틀리면 원인을 찾기 어렵다.
    const list = [...complete(4), { a: 'v0', b: 'v0' }, { a: 'v1', b: 'v2' }]
    expect(isPlanar(nodesOf(list), list)).toBe(true)
  })
})

describe('skewness', () => {
  // 평면으로 만들려면 간선을 최소 몇 개 빼야 하는가. 3단계에서 "그만큼 빼고
  // 임베딩한 뒤 도로 그린다"의 그 개수이자, 그 사건이 **어떻게 그려도 피할 수
  // 없는 교차**의 하한이기도 하다.
  it('평면 그래프는 0이다', () => {
    const list = complete(4)
    expect(skewness(nodesOf(list), list, 4)).toBe(0)
  })

  it('K5와 K3,3은 1이다', () => {
    // 둘 다 극소 비평면 그래프다 — 어느 간선 하나를 빼도 평면이 된다.
    const k5 = complete(5)
    const k33 = bipartite(3, 3)
    expect(skewness(nodesOf(k5), k5, 4)).toBe(1)
    expect(skewness(nodesOf(k33), k33, 4)).toBe(1)
  })

  it('페테르센 그래프는 2다', () => {
    const list = edges(`
      o0-o1 o1-o2 o2-o3 o3-o4 o4-o0
      i0-i2 i2-i4 i4-i1 i1-i3 i3-i0
      o0-i0 o1-i1 o2-i2 o3-i3 o4-i4
    `)
    expect(skewness(nodesOf(list), list, 4)).toBe(2)
  })

  it('K6은 3이다', () => {
    const list = complete(6)
    expect(skewness(nodesOf(list), list, 4)).toBe(3)
  })

  it('상한을 넘으면 null을 준다 — 못 찾은 것과 큰 것을 섞지 않는다', () => {
    // 전수 탐색이라 상한이 필요하다. 0을 주는 대신 null을 주는 이유는, 부르는
    // 쪽이 "빼야 할 게 없다"와 "얼마나 빼야 할지 모른다"를 반드시 구별해야 하기
    // 때문이다 — 3단계가 갈리는 지점이 정확히 거기다.
    const list = complete(6)
    expect(skewness(nodesOf(list), list, 2)).toBeNull()
  })
})

describe('planarPositions', () => {
  /** 직선으로 이었을 때 서로 만나는 간선 쌍. 끝점을 공유하는 쌍은 뺀다. */
  function straightCrossings(
    places: Map<string, { x: number; y: number }>,
    list: PlanarEdge[],
  ): number {
    const side = (o: number[], a: number[], b: number[]) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const at = (w: string) => [places.get(w)!.x, places.get(w)!.y]

    let count = 0
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i]
        const q = list[j]
        if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue
        const [p1, p2, p3, p4] = [at(p.a), at(p.b), at(q.a), at(q.b)]
        const d1 = side(p3, p4, p1)
        const d2 = side(p3, p4, p2)
        const d3 = side(p1, p2, p3)
        const d4 = side(p1, p2, p4)
        if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) count++
      }
    }
    return count
  }

  const cube = edges(`
    a-b b-c c-d d-a
    e-f f-g g-h h-e
    a-e b-f c-g d-h
  `)
  const wheel = edges('h-a h-b h-c h-d a-b b-c c-d d-a')

  it('K4를 교차 없이 그린다', () => {
    // 지금 배치는 K4에 교차를 하나 낸다. 네 점짜리 평면 그래프다.
    const list = complete(4)
    const places = planarPositions(nodesOf(list), list)
    expect(places).not.toBeNull()
    expect(straightCrossings(places!, list)).toBe(0)
  })

  it('바퀴를 교차 없이 그린다', () => {
    // 지금 배치는 셋을 낸다.
    const places = planarPositions(nodesOf(wheel), wheel)
    expect(places).not.toBeNull()
    expect(straightCrossings(places!, wheel)).toBe(0)
  })

  it('정육면체를 교차 없이 그린다', () => {
    // 이 시험이 제일 세다. 8점 12선, 누구나 평면으로 그릴 줄 아는 그래프인데
    // 지금 배치는 **교차 23개**를 낸다 — 12개 간선에서 나올 수 있는 66쌍 중 23쌍.
    const places = planarPositions(nodesOf(cube), cube)
    expect(places).not.toBeNull()
    expect(straightCrossings(places!, cube)).toBe(0)
  })

  it('모든 점이 서로 다른 자리에 놓인다', () => {
    // Tutte 그림은 꼭짓점이 겹치거나 한 직선에 몰릴 수 있고, 그러면 교차는 0이라도
    // 라벨을 놓을 수 없다. 겹친 점은 실패로 다뤄야지 성공으로 돌려주면 안 된다.
    const places = planarPositions(nodesOf(cube), cube)!
    const seen = new Set([...places.values()].map((p) => `${p.x.toFixed(6)} ${p.y.toFixed(6)}`))
    expect(seen.size).toBe(places.size)
  })

  it('평면이 아니면 null이다', () => {
    const list = complete(5)
    expect(planarPositions(nodesOf(list), list)).toBeNull()
  })

  it('같은 입력은 같은 좌표를 준다', () => {
    // 배치 전체가 결정적이라는 것이 이 저장소의 불변식이다 — e2e가 좌표에 단정을
    // 걸고, 같은 날은 같은 그림을 내야 한다.
    const first = planarPositions(nodesOf(cube), cube)!
    const second = planarPositions(nodesOf(cube), cube)!
    for (const [word, point] of first) {
      expect(second.get(word)!.x).toBe(point.x)
      expect(second.get(word)!.y).toBe(point.y)
    }
  })
})

describe('nearPlanarPositions', () => {
  const petersen = edges(`
    o0-o1 o1-o2 o2-o3 o3-o4 o4-o0
    i0-i2 i2-i4 i4-i1 i1-i3 i3-i0
    o0-i0 o1-i1 o2-i2 o3-i3 o4-i4
  `)

  function crossingsAmong(
    places: Map<string, { x: number; y: number }>,
    list: PlanarEdge[],
  ): number {
    const side = (o: number[], a: number[], b: number[]) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const at = (w: string) => [places.get(w)!.x, places.get(w)!.y]
    let count = 0
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i]
        const q = list[j]
        if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue
        const [p1, p2, p3, p4] = [at(p.a), at(p.b), at(q.a), at(q.b)]
        if (
          side(p3, p4, p1) > 0 !== side(p3, p4, p2) > 0 &&
          side(p1, p2, p3) > 0 !== side(p1, p2, p4) > 0
        ) {
          count++
        }
      }
    }
    return count
  }

  it('K5는 간선 하나만 빼고 나머지를 교차 없이 그린다', () => {
    const list = complete(5)
    const drawing = nearPlanarPositions(nodesOf(list), list, 2)!
    expect(drawing.dropped).toHaveLength(1)

    const kept = list.filter((e) => !drawing.dropped.some((d) => d.a === e.a && d.b === e.b))
    expect(crossingsAmong(drawing.places, kept)).toBe(0)
  })

  it('페테르센 그래프는 둘을 뺀다 — 그 사건의 피할 수 없는 교차가 둘이라는 뜻이다', () => {
    const drawing = nearPlanarPositions(nodesOf(petersen), petersen, 3)!
    expect(drawing.dropped).toHaveLength(2)

    const kept = petersen.filter((e) => !drawing.dropped.some((d) => d.a === e.a && d.b === e.b))
    expect(crossingsAmong(drawing.places, kept)).toBe(0)
  })

  it('허용치보다 더 빼야 하면 null이다', () => {
    // K6은 셋을 빼야 한다. 둘까지만 허용하면 포기해야지, 둘만 빼고 나머지가
    // 교차하는 그림을 "성공"이라고 돌려주면 안 된다.
    const list = complete(6)
    expect(nearPlanarPositions(nodesOf(list), list, 2)).toBeNull()
  })

  it('평면 그래프는 아무것도 안 뺀다', () => {
    const list = complete(4)
    const drawing = nearPlanarPositions(nodesOf(list), list, 2)!
    expect(drawing.dropped).toEqual([])
  })
})
