import { describe, expect, it } from 'vitest'
import { isPlanar, skewness, type PlanarEdge } from './planar'

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
