import { forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { mergeCommunities } from '../lib/events'
import type { GraphEdge } from '../lib/types'
import { nearPlanarPositions, type PlanarPoint } from './planar'

// Everything in this file is arithmetic, deliberately separated from
// KeywordGraph.tsx so it can be tested under jsdom. The one thing jsdom cannot
// do is measure text — canvas is unimplemented — so measured widths arrive as
// arguments. Same split as wordCloudLayout.ts.
//
// 이 파일은 하나의 전역 시뮬레이션이었다. 그 배치의 문제는 튜닝이 아니라 구조에
// 있었다: 하루는 헤어볼이 아니라 3~8단어짜리 별자리 여남은 개 + 아무와도 이어지지
// 않은 23~28개인데(scripts/layout/README.md의 baseline), 전역 시뮬레이션은 그
// 구조를 모른 채 전부를 한 통에 넣고 흔들었고 무연결 단어를 캔버스 *안쪽* 고리로
// 보내 사건들 사이사이에 끼워 넣었다. 그래서 모든 선이 남의 사건을 관통해야 했다.
//
// 지금은 두 단계다. **A단계**는 사건마다 자기 상자 안에서 배치하고, **B단계**는 그
// 상자들을 폭에 채운다. 분리가 힘의 균형이 아니라 배치에서 나오므로 보장된다.

export interface MeasuredWord {
  word: string
  count: number
  fontSize: number
  /** Width of the rendered label in px, measured by the caller. */
  textWidth: number
  faded: boolean
}

export interface PlacedNode extends MeasuredWord {
  x: number
  y: number
  halfWidth: number
  halfHeight: number
}

/** One quadratic Bezier: the whole of an edge, as a single unbroken stroke. */
export interface EdgeCurve {
  x1: number
  y1: number
  /** Control point. Sits on the chord exactly when nothing is in the way. */
  cx: number
  cy: number
  x2: number
  y2: number
  /**
   * Whether this route keeps off every other label.
   *
   * False happens: a long edge can cross something whichever way it bows, and
   * no single quadratic threads that field. Dropping those loses relationships,
   * so they are drawn anyway and the caller fades them instead — a faint line
   * under a word beats a missing connection.
   */
  clear: boolean
}

export interface PlacedEdge extends GraphEdge {
  /** Centre to centre, before the ends are pulled out of their own labels. */
  x1: number
  y1: number
  x2: number
  y2: number
  /**
   * The stroke to draw, or null when the labels leave no room for one.
   *
   * Deliberately one curve rather than a list of pieces. This used to cut every
   * label box out of the straight line and draw the remainder, which kept the
   * strokes off the text but split a long edge into up to five fragments —
   * measured on 2026-08-01, where 15 of 63 drawn edges arrived in pieces and
   * 트럼프—에너지시설 arrived in five. Several collinear dashes read as several
   * relationships, and the strength of one is already carried by its width.
   */
  curve: EdgeCurve | null
}

/**
 * 한 사건이 차지한 구역.
 *
 * **그려지지 않는다.** 구역은 여백으로만 읽힌다 — 테두리도 이름도 없다. hull을
 * 걷어낸 이유와 같고(hull은 멤버들 사이에 우연히 놓인 남의 단어까지 삼킨다),
 * 사건 이름은 캔버스 위의 사건 목록이 이미 말한다.
 *
 * 그럼에도 내보내는 이유는 하나뿐이다: **구역끼리 겹치지 않는다**는 것이 이
 * 배치의 핵심 불변식이고, 그걸 테스트가 확인할 수 있어야 한다. 화면이 읽지 않는
 * 필드를 두는 것은 clusters가 그랬듯 위험하지만, 저건 아무도 읽지 않았고 이건
 * graphLayout.test.ts가 읽는다.
 */
export interface EventRegion {
  /** mergeCommunities가 준 사건 id. */
  id: number
  words: string[]
  x: number
  y: number
  width: number
  height: number
}

export interface GraphLayout {
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  /** 사건 구역. 넓은 것부터. 그려지지 않는다 — EventRegion의 주석을 볼 것. */
  regions: EventRegion[]
  /**
   * Every drawn word's Louvain community, uncut — including the singletons and
   * the edgeless words, which each keep an id of their own.
   *
   * The canvas hands this up so src/lib/events.ts can build the event list out
   * of the same partition the layout ran on. Exposing it rather than
   * recomputing it is the point: a second copy of the partition is the hazard
   * CLAUDE.md records against keyword_signals.
   */
  communities: Map<string, number>
  /** Tight box around the drawn labels, for cropping the viewport to them. */
  bounds: { x: number; y: number; width: number; height: number }
}

export interface LayoutOptions {
  /** 채워 넣을 폭. **높이는 입력이 아니라 결과다** — bounds.height가 답이다. */
  width: number
  /** Simulation steps run synchronously before the first paint. */
  ticks?: number
  seed?: number
  /** Gap kept between two label boxes. */
  padding?: number
}

const DEFAULT_TICKS = 300
const DEFAULT_SEED = 0x5eed
// Labels rest this far apart. It has to leave more room than the edge routing
// consumes — a clearance either side plus a minimum drawable length — or two
// clustered words end up close enough that the whole line between them is cut
// away and the edge silently disappears.
const DEFAULT_PADDING = 16

// 사건 구역 사이의 간격. 단어 사이 간격의 세 배여야 "저건 다른 이야기"가 여백만으로
// 읽힌다 — 같은 크기로 두면 구역의 경계가 그냥 또 하나의 단어 간격이 되어 아무것도
// 나누지 못한다.
const GUTTER_RATIO = 3

// A rendered label is taller than its font size: getBBox on the drawn <text>
// reports about 1.2em for Hangul in a sans-serif, since the box spans ascender
// to descender. Treating the em box as the collision height left neighbouring
// rows grazing each other by a pixel — measured at 1px on the 정치 and IT tabs.
const LINE_HEIGHT = 1.2

// 별 배치에서 반지름을 키우는 비율과 시도 횟수. 라벨 폭이 제각각이라 각도를 고르게
// 나누면 넓은 라벨끼리 부딪히는데, 반지름을 통째로 키우면 원둘레가 늘어 반드시
// 해소된다 — 라벨 크기는 고정이므로 수렴이 보장된다.
const RADIAL_GROWTH = 1.12
const RADIAL_TRIES = 40

// 로컬 시뮬레이션이 받을 상자의 가로세로비. 캔버스가 가로로 길고 구역도 가로로
// 눕는 편이 선반 패킹에서 덜 버려진다.
const LOCAL_ASPECT = 1.5

// 로컬 상자를 라벨 넓이 합의 몇 배로 잡을지.
//
// **1이면 안 된다.** 라벨 크기가 제각각이라 빈틈 없이 채울 수 없고, 넓이 합과
// 똑같은 상자에서는 충돌이 끝내 해소되지 않는다 — 측정하면 라벨 겹침이 네 날
// 모두에서 12~19쌍 나왔다(불변식은 0이다). 게다가 붙어 버린 두 라벨 사이에는
// 선을 그릴 자리가 없어져 엣지가 조용히 사라진다: 37개 중 22개만 그려졌다.
// CLAUDE.md가 응집력 0.35에 대해 기록한 바로 그 고장이다.
//
// 넉넉해도 비용이 없다는 것이 이 값을 고르기 쉽게 만든다. 구역의 크기는 상자가
// 아니라 crop이 정하므로, 남는 여백은 그냥 잘려 나간다.
const LOCAL_SLACK = 3.5

interface LayoutNode extends SimulationNodeDatum, MeasuredWord {
  halfWidth: number
  halfHeight: number
}

type LayoutLink = SimulationLinkDatum<LayoutNode> & GraphEdge

// mulberry32, wired into the simulations below.
//
// This does not make the layout deterministic — it already is. Initial
// positions are seeded, and d3's random source is reached only to jiggle two
// nodes that occupy the exact same point, by +/-5e-7. Passing a source of our
// own pins that behaviour to this file rather than to a d3 internal, so a
// change there cannot quietly start moving the graph between reloads and
// flaking the e2e suite.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// d3's own forceCollide is circular, and a circle around a wide label wastes
// most of its area: 반도체 at 40px is roughly 120x40, so a bounding circle is
// three times taller than the text. Words end up floating in gaps. This is the
// rectangular equivalent — separate along whichever axis overlaps least, which
// is the minimum translation that resolves the collision.
function rectCollide(padding: number, strength: number) {
  let nodes: LayoutNode[] = []

  // Quadratic, but it now runs per event rather than over the whole day, so the
  // biggest case measured is 14 nodes — 91 pairs a tick instead of 2,415.
  function force() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        const dx = (b.x ?? 0) - (a.x ?? 0)
        const overlapX = a.halfWidth + b.halfWidth + padding - Math.abs(dx)
        if (overlapX <= 0) continue

        const dy = (b.y ?? 0) - (a.y ?? 0)
        const overlapY = a.halfHeight + b.halfHeight + padding - Math.abs(dy)
        if (overlapY <= 0) continue

        if (overlapX < overlapY) {
          // dx of exactly 0 pushes b right and a left rather than picking a
          // direction at random, so two identical positions still resolve.
          const push = (dx < 0 ? -overlapX : overlapX) * 0.5 * strength
          a.vx = (a.vx ?? 0) - push
          b.vx = (b.vx ?? 0) + push
        } else {
          const push = (dy < 0 ? -overlapY : overlapY) * 0.5 * strength
          a.vy = (a.vy ?? 0) - push
          b.vy = (b.vy ?? 0) + push
        }
      }
    }
  }

  force.initialize = (n: LayoutNode[]) => {
    nodes = n
  }

  return force
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

// d3-force lays out any node without an x/y on a phyllotaxis spiral centred on
// the origin — the top-left corner — and expects the centring forces to carry
// it in from there. At the force strengths this layout needs, 300 ticks is not
// enough to travel half a box, so nodes settled in a clump up and to the left
// with the rest of the frame empty. Seeding the same spiral, centred and scaled
// to the box, fixes the drift and starts the simulation somewhere plausible.
//
// sqrt of the index is what makes the points evenly dense rather than bunched
// in the middle, and the count normalises it so eight words spread as widely as
// a hundred do.
function initialPosition(
  index: number,
  total: number,
  width: number,
  height: number,
  padding: number,
): { x: number; y: number; vx: number; vy: number } {
  const t = Math.sqrt((index + 0.5) / total)
  const angle = index * GOLDEN_ANGLE
  return {
    x: width / 2 + t * Math.max(0, width / 2 - padding) * Math.cos(angle),
    y: height / 2 + t * Math.max(0, height / 2 - padding) * Math.sin(angle),
    vx: 0,
    vy: 0,
  }
}

// 리사이즈가 폭을 이만큼 움직이기 전에는 레이아웃을 다시 돌리지 않는다.
//
// 8px이 보이지 않는 이유: svg는 자기 크기로 그려진 뒤 max-w-full로 축소되므로,
// 8px 어긋난 폭으로 돈 레이아웃은 1% 다른 배율로 같은 그림을 낸다.
const WIDTH_STEP = 8

export function nextLayoutWidth(
  current: number,
  measured: number,
  threshold: number = WIDTH_STEP,
): number | null {
  // 숨겨진 컨테이너의 ResizeObserver는 0을 보고한다. 그 폭으로 돌리면 라벨이
  // 전부 한 점에 쌓인다.
  if (!(measured > 0)) return null
  const next = Math.round(measured)
  return Math.abs(next - current) < threshold ? null : next
}

export function computeGraphLayout(
  words: MeasuredWord[],
  edges: GraphEdge[],
  options: LayoutOptions,
): GraphLayout {
  if (words.length === 0) {
    return {
      nodes: [],
      edges: [],
      regions: [],
      communities: new Map(),
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }
  }

  const { width, ticks = DEFAULT_TICKS, seed = DEFAULT_SEED, padding = DEFAULT_PADDING } = options
  const gutter = padding * GUTTER_RATIO

  const nodes: LayoutNode[] = words.map((w) => ({
    ...w,
    halfWidth: w.textWidth / 2,
    halfHeight: (w.fontSize * LINE_HEIGHT) / 2,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  }))

  const byWord = new Map(nodes.map((n) => [n.word, n]))

  // The RPC only emits edges between rendered nodes, but the layout must not
  // depend on that: d3's forceLink throws on an unresolvable endpoint, which
  // would take the whole graph down over one stray word.
  const links: LayoutLink[] = edges
    .filter((e) => byWord.has(e.a) && byWord.has(e.b))
    .map((e) => ({ ...e, source: e.a, target: e.b }))

  // Communities come from the edge topology alone, so they can be found before
  // anything is positioned — which is what lets each event be laid out in its
  // own box rather than discovering the grouping after the fact.
  const communities = detectCommunities(words, links)

  // **구역의 단위는 합쳐진 사건이다.** 날것의 루뱅 커뮤니티가 아니다: 목록은
  // 커뮤니티 둘이 MERGE_MIN_EDGES 이상으로 이어지면 한 사건으로 부르므로,
  // 커뮤니티로 나누면 목록이 하나라고 부르는 이야기를 캔버스가 두 상자로 쪼갠다.
  // src/lib/events.ts가 그 병합의 유일한 사본을 들고 있고 여기서 그걸 부른다.
  const eventOf = new Map(mergeCommunities(words, links, communities))

  const degrees = new Map<string, number>()
  for (const l of links) {
    degrees.set(l.a, (degrees.get(l.a) ?? 0) + 1)
    degrees.set(l.b, (degrees.get(l.b) ?? 0) + 1)
  }

  // 엣지를 가졌는데 병합이 사건을 주지 않은 단어 — 루뱅이 혼자 남긴 경우 — 는
  // 자기 혼자짜리 구역을 받는다. 무연결 단어 띠로 보내면 그 단어의 선이 띠에서
  // 구역까지 화면을 가로지르게 된다.
  let solo = -1
  for (const node of nodes) {
    if (eventOf.has(node.word) || (degrees.get(node.word) ?? 0) === 0) continue
    eventOf.set(node.word, solo--)
  }

  const members = new Map<number, LayoutNode[]>()
  for (const node of nodes) {
    const id = eventOf.get(node.word)
    if (id === undefined) continue
    const group = members.get(id)
    if (group) group.push(node)
    else members.set(id, [node])
  }

  const linksByEvent = new Map<number, LayoutLink[]>()
  for (const l of links) {
    const a = eventOf.get(l.a)
    if (a === undefined || a !== eventOf.get(l.b)) continue
    const held = linksByEvent.get(a)
    if (held) held.push(l)
    else linksByEvent.set(a, [l])
  }

  // --- A단계: 사건마다 자기 상자 안에서 --------------------------------------
  const boxes: LaidOutEvent[] = []
  for (const [id, group] of members) {
    boxes.push(layoutEvent(id, group, linksByEvent.get(id) ?? [], padding, ticks, seed))
  }
  // 넓은 사건부터. 하루의 제일 큰 이야기가 읽기가 시작되는 왼쪽 위에 놓인다.
  // 동수는 첫 단어로 깨서 같은 날이 같은 그림을 낸다.
  boxes.sort((a, b) => b.width * b.height - a.width * a.height || a.first.localeCompare(b.first))
  const packOrder = orderForPacking(boxes, links, eventOf)

  const packed = shelfPack(
    packOrder.map((b) => ({ width: b.width, height: b.height })),
    width,
    gutter,
  )

  const regions: EventRegion[] = packOrder.map((box, i) => ({
    id: box.id,
    words: box.words,
    x: round(packed.spots[i].x),
    y: round(packed.spots[i].y),
    width: round(box.width),
    height: round(box.height),
  }))

  for (let i = 0; i < packOrder.length; i++) {
    const spot = packed.spots[i]
    for (const node of packOrder[i].members) {
      node.x = (node.x ?? 0) + spot.x
      node.y = (node.y ?? 0) + spot.y
    }
  }

  faceBridges(packOrder, packed.spots, links, eventOf)

  // --- 무연결 단어는 구역 **바깥**으로 ---------------------------------------
  //
  // 이 단어들이 가운데를 붐비게 만드는 주범이었다: 70개 중 23~28개가 아무 선도
  // 갖지 않는데, 예전에는 캔버스 안쪽 고리(반지름 0.36~0.52)로 보내져 사건들
  // 사이사이에 끼었다. 안쪽 고리가 아니라 아래 띠라서 가운데가 완전히 빈다.
  const loose = nodes.filter((n) => !eventOf.has(n.word))
  const looseTop = packed.height > 0 && loose.length > 0 ? packed.height + gutter : packed.height
  const looseSize = flowRows(loose, width, padding, looseTop)

  const placed: PlacedNode[] = nodes.map((n) => ({
    word: n.word,
    count: n.count,
    fontSize: n.fontSize,
    textWidth: n.textWidth,
    faded: n.faded,
    halfWidth: n.halfWidth,
    halfHeight: n.halfHeight,
    x: round(n.x ?? 0),
    y: round(n.y ?? 0),
  }))

  // 사건 구역들과 무연결 띠의 폭이 서로 다르므로, 둘 다 실제로 쓰인 폭 안에서
  // 가운데로 민다. 왼쪽에 맞추면 아래위가 어긋난 채로 남아 배치가 의도된 것이
  // 아니라 흘러넘친 것처럼 보인다.
  const content = Math.max(packed.width, looseSize.width)
  centerRows(placed, regions, packed, packOrder, looseSize, content)

  const placedByWord = new Map(placed.map((n) => [n.word, n]))

  const placedEdges: PlacedEdge[] = links.map((l) => {
    const a = placedByWord.get(l.a)!
    const b = placedByWord.get(l.b)!
    return {
      a: l.a,
      b: l.b,
      cooc: l.cooc,
      npmi: l.npmi,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      curve: routeEdge(a, b, placed),
    }
  })

  return {
    nodes: placed,
    edges: placedEdges,
    regions,
    communities,
    bounds: boundingBox(placed, padding),
  }
}

// --- A단계 -----------------------------------------------------------------

interface LaidOutEvent {
  id: number
  words: string[]
  members: LayoutNode[]
  /** 좌상단이 (0,0)이 되도록 이미 옮겨진 상자의 크기. */
  width: number
  height: number
  /** 정렬 tie-break용, 결정성을 위해. */
  first: string
}

/**
 * 한 사건을 자기 상자 안에 배치한다. 멤버의 x/y는 상자 좌표(좌상단 0,0)로 들어간다.
 *
 * 배열 방식은 취향이 아니라 **위상으로** 고른다. 진짜 별 — 최대 차수가 멤버−1 —
 * 이면 바큇살로 놓는다: 선이 전부 짧고 방사형이라 교차가 원천적으로 없다. 그
 * 밖은 로컬 시뮬레이션이다.
 *
 * 전부 방사형으로 통일하지 않는 이유는 측정된 것이다: 3단어 이상 사건 25개 중
 * 별·나무가 11, 덩어리가 14인데 **하루의 제일 큰 사건은 네 날 내내 예외 없이
 * 덩어리다** — 08-02 전당대회 13단어/27엣지(나무라면 12), 08-03 전당대회
 * 12단어/23엣지, 08-03 트럼프·우크라 14단어/15엣지. 방사형으로 밀어붙이면 바큇살
 * 사이를 가로지르는 현이 15개 남고, 그게 지금 벗어나려는 그 난잡함이다.
 */
function layoutEvent(
  id: number,
  members: LayoutNode[],
  links: LayoutLink[],
  padding: number,
  ticks: number,
  seed: number,
): LaidOutEvent {
  // 멤버 순서를 여기서 못박는다. 호출자가 준 순서는 빈도순이지만, 배치가 그
  // 순서에 기대는 곳이 여럿이라 한 번에 정해 두는 편이 낫다.
  const ordered = [...members].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))

  if (ordered.length === 1) {
    const only = ordered[0]
    only.x = only.halfWidth
    only.y = only.halfHeight
  } else if (ordered.length === 2) {
    // 둘뿐이면 나란히. 시뮬레이션을 돌릴 것이 없다 — 링크는 당기고 충돌은 밀어
    // 결국 옆에 서는데, 그 결과를 300틱 들여 알아낼 이유가 없다.
    const [a, b] = ordered
    a.x = a.halfWidth
    a.y = Math.max(a.halfHeight, b.halfHeight)
    b.x = a.halfWidth * 2 + padding + b.halfWidth
    b.y = a.y
  } else if (isStar(ordered, links)) {
    placeRadially(ordered, links, padding)
  } else {
    layoutCluster(ordered, links, padding, ticks, seed)
  }

  const box = crop(ordered)
  for (const n of ordered) {
    n.x = (n.x ?? 0) - box.x
    n.y = (n.y ?? 0) - box.y
  }

  return {
    id,
    words: ordered.map((n) => n.word),
    members: ordered,
    width: box.width,
    height: box.height,
    first: ordered[0].word,
  }
}

function degreesWithin(members: LayoutNode[], links: LayoutLink[]): Map<string, number> {
  const degrees = new Map<string, number>()
  for (const n of members) degrees.set(n.word, 0)
  for (const l of links) {
    degrees.set(l.a, (degrees.get(l.a) ?? 0) + 1)
    degrees.set(l.b, (degrees.get(l.b) ?? 0) + 1)
  }
  return degrees
}

/** 한 멤버가 나머지 전부와 이어져 있고 그 밖의 선은 없는가. */
function isStar(members: LayoutNode[], links: LayoutLink[]): boolean {
  if (links.length !== members.length - 1) return false
  const degrees = degreesWithin(members, links)
  return Math.max(...degrees.values()) === members.length - 1
}

// The word the event is arranged around: the member holding the most edges,
// which is the one the other members have in common. Ties break on headline
// count and then on the word, so the same day always picks the same hub.
//
// 허브를 가운데 두는 것은 무게중심을 쓰는 것과 다르다. 둘 다 사건을 붙여 놓지만
// 무게중심은 아무 단어도 차지하지 않은 빈 점이라, 멤버들이 구멍을 둘러싸고 서고
// 가운데에 사건을 읽을 것이 없다.
function chooseHub(members: LayoutNode[], degrees: Map<string, number>): LayoutNode {
  let best = members[0]
  for (const n of members) {
    if (n === best) continue
    const dn = degrees.get(n.word) ?? 0
    const db = degrees.get(best.word) ?? 0
    if (dn !== db ? dn > db : n.count !== best.count ? n.count > best.count : n.word < best.word) {
      best = n
    }
  }
  return best
}

function placeRadially(members: LayoutNode[], links: LayoutLink[], padding: number): void {
  const hub = chooseHub(members, degreesWithin(members, links))
  const leaves = members.filter((n) => n !== hub)

  // 허브가 원점. 12시부터 시계방향으로 고르게.
  let radius = hub.halfWidth + Math.max(...leaves.map((n) => n.halfWidth)) + padding
  for (let attempt = 0; attempt < RADIAL_TRIES; attempt++) {
    hub.x = 0
    hub.y = 0
    leaves.forEach((leaf, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / leaves.length
      leaf.x = radius * Math.cos(angle)
      leaf.y = radius * Math.sin(angle)
    })
    if (!anyOverlap(members, padding)) return
    radius *= RADIAL_GROWTH
  }
}

/**
 * 자리를 맞바꿔 가며 사건 **안쪽**의 선 교차를 줄인다.
 *
 * 이게 필요하다는 것은 측정이 알려준 것이고, 알려주기 전까지는 다리 탓인 줄
 * 알았다. 구역을 나누고 나서 남은 교차를 구역 안(`xIn`)과 다리가 낀 것(`xBr`)으로
 * 갈라 보니 08-02는 16 대 0, 08-03은 18 대 0이었다 — 사건들 사이는 이미 깨끗했고
 * 난잡함은 통째로 하루의 제일 큰 사건 **하나 안에** 있었다. 13단어 27엣지짜리
 * 덩어리를 힘 균형으로 펴는 데는 한계가 있다.
 *
 * 그래서 재는 값을 직접 줄인다. 두 멤버의 좌표를 맞바꿔 보고 교차가 줄면 남긴다.
 * 멤버가 14개를 넘지 않으므로 모든 쌍을 봐도 91가지고, 판정은 곡선이 아니라
 * 직선 현으로 한다 — 곡선 라우팅은 이 다음에 오고, 어차피 교차하는 곡선은
 * 교차하는 현에서 나온다.
 *
 * **맞바꾼 뒤에는 충돌을 다시 푼다.** 이걸 빼면 아무 효과도 없다 — 한 사건 안의
 * 라벨 폭은 50px에서 200px까지 벌어지므로(08-02의 정청래 160, 양산 63), 넓은
 * 라벨을 좁은 라벨 자리에 그대로 놓으면 반드시 이웃과 부딪힌다. 겹치면 거부하는
 * 첫 판본은 사실상 모든 맞바꿈을 거부해서 교차를 하나도 줄이지 못했다.
 * 그러고도 안 풀리면 그 맞바꿈은 되돌린다.
 *
 * 결정적이다: 쌍을 고정된 순서로 훑고 개선되는 것만 남긴다.
 */
function untangle(members: LayoutNode[], links: LayoutLink[], padding: number): void {
  if (links.length < 2) return

  const snapshot = () => members.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }))
  const restore = (saved: { x: number; y: number }[]) => {
    members.forEach((n, i) => {
      n.x = saved[i].x
      n.y = saved[i].y
    })
  }

  let best = countCrossings(members, links)
  for (let round = 0; round < UNTANGLE_ROUNDS && best > 0; round++) {
    let improved = false
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const saved = snapshot()
        const a = members[i]
        const b = members[j]
        const x = a.x
        const y = a.y
        a.x = b.x
        a.y = b.y
        b.x = x
        b.y = y

        relax(members, padding)
        const now = countCrossings(members, links)
        if (now < best && !anyOverlap(members, padding)) {
          best = now
          improved = true
        } else {
          restore(saved)
        }
      }
    }
    if (!improved) break
  }
}

/**
 * 교차 하나를 없애는 데 상자를 몇 배까지 키워 줄지.
 *
 * 교차를 없애는 값은 자리다. 평면 그림은 라벨이 떨어질 때까지 키워야 하고, 커진
 * 상자는 그 사건이 캔버스에서 먹는 자리이자 하루 전체의 세로 길이다.
 *
 * **정액이 아니라 정률인 이유**는 재고 알았다. "넓이 5배까지"라는 고정 예산은
 * 교차 하나를 없애는 것과 스물셋을 없애는 것에 같은 값을 매긴다. 그래서 정육면체
 * (8점 12선, 교차 23개)가 거부됐다 — 라벨이 다 같은 크기라 힘 배치가 아주 촘촘한
 * 상자를 내놓고, 평면 그림은 그보다 다섯 배가 넘게 필요했다. 23개를 없애는 데
 * 그만큼도 못 쓴다는 것은 말이 안 된다. 얻는 만큼 낸다.
 */
const PLANAR_AREA_PER_CROSSING = 0.5

/**
 * 덩어리 사건 하나를 배치한다 — 힘으로 한 번, 되면 평면으로 한 번, 나은 쪽.
 *
 * 힘 균형이 조밀한 사건을 못 편다는 것은 측정된 사실이다. 08-02의 전당대회는
 * 교차 15개를 내는데 `LOCAL_SLACK` 훑기로도 `untangle`로도 안 줄었다. 그런데
 * `scripts/layout/planarity.ts`를 돌려 보면 **교차를 내는 여섯 사건 중 다섯이
 * 완전히 평면**이다 — 하한 합계 2에 실제 30. 즉 거의 전부가 그래프 탓이 아니라
 * 배치 탓이고, 힘 균형은 그걸 푸는 도구가 아니다.
 *
 * 그래서 평면으로 그릴 수 있으면 그렇게 그린다. `planarPositions`는 **교차 0을
 * 확인한 그림만** 돌려주므로 여기서 다시 셀 필요가 없고, 못 그리면 null이라
 * 힘 배치가 그대로 남는다.
 *
 * **단위원 좌표를 라벨이 떨어질 때까지 통째로 키우는 것이 안전한 이유**는 교차가
 * 닮음변환에 불변이기 때문이다. 좌표를 하나씩 밀어 겹침을 풀면 교차가 되살아날 수
 * 있지만, 전체를 같은 배율로 키우면 위상이 그대로다.
 */
function layoutCluster(
  members: LayoutNode[],
  links: LayoutLink[],
  padding: number,
  ticks: number,
  seed: number,
): void {
  simulateLocally(members, links, padding, ticks, seed)
  untangle(members, links, padding)

  const forced = countCrossings(members, links)
  if (forced === 0) return

  // 비평면이면 최소한만 빼고 나머지를 평면으로 그린다. 뺀 것은 그냥 얹으므로
  // 나오는 그림의 교차는 0이 아니라 뺀 개수 근처가 되고, 그래서 아래에서 "교차 0"이
  // 아니라 **"지금보다 적으면"**으로 받는다. 08-02의 전당대회가 그 경우다 — 왜곡도
  // 2에 실제 27이므로 스물다섯은 배치 탓이고 둘은 어떻게 그려도 남는다.
  const drawing = nearPlanarPositions(
    members.map((n) => n.word),
    links,
    MAX_EDGES_DROPPED,
  )
  if (!drawing) return

  const saved = members.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }))
  const forcedArea = areaOf(members)

  // **평면 좌표를 실제 자리로 바꾸는 방법이 둘이고, 둘은 서로 다른 사건을 푼다.**
  // 둘 다 재고 나은 쪽을 쓴다 — 어느 하나가 늘 이긴다는 근거가 없고, 실제로
  // 벌리기는 08-02를 16에서 5로 내리고 확대는 08-03을 14에서 5로 내렸다. 하나만
  // 쓰면 나머지 한 날을 그냥 버리는 것이 된다.
  interface Candidate {
    crossings: number
    area: number
    at: { x: number; y: number }[]
  }
  let best: Candidate | null = null

  // **예산은 경쟁에 들어가는 조건이지 우승자를 재는 잣대가 아니다.** 나중에 걸면
  // "교차는 제일 적지만 너무 큰" 후보가 이긴 뒤 탈락하면서, 예산 안에 드는 다른
  // 후보까지 같이 버려진다. 08-02가 그렇게 5에서 15로 되돌아갔었다.
  const consider = () => {
    if (anyOverlap(members, padding)) return
    const crossings = countCrossings(members, links)
    if (crossings >= forced) return
    const area = areaOf(members)
    if (area > forcedArea * (1 + PLANAR_AREA_PER_CROSSING * (forced - crossings))) return

    // 교차가 먼저, 같으면 좁은 쪽. 넓이가 값이고 교차가 얻는 것이므로, 더 싼
    // 그림을 찾자고 덜 편 그림을 고를 수는 없다.
    const current: Candidate = { crossings, area, at: members.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 })) }
    if (
      best === null ||
      current.crossings < best.crossings ||
      (current.crossings === best.crossings && current.area < best.area)
    ) {
      best = current
    }
  }

  spreadPlanar(members, links, drawing.places, padding)
  consider()

  const full = separatingScale(members, drawing.places, padding)
  for (const step of PLANAR_SCALE_STEPS) {
    for (const node of members) {
      const point = drawing.places.get(node.word)!
      node.x = point.x * full * step
      node.y = point.y * full * step
    }
    if (step < 1) relax(members, padding)
    consider()
  }

  const chosen: { x: number; y: number }[] = best === null ? saved : (best as Candidate).at
  members.forEach((n, i) => {
    n.x = chosen[i].x
    n.y = chosen[i].y
  })
}

/**
 * 겹침을 통째로 키워서 풀 때, 필요한 배율의 몇 배부터 시험할지.
 *
 * **배율과 넓이는 같이 가지 않는다.** 너무 작게 놓으면 라벨이 전부 겹치고, 그걸
 * `relax`가 미느라 사방으로 흩어져 오히려 상자가 커진다. 그래서 제일 먼저 통과하는
 * 것을 쓰지 않고 전부 재본다 — 단계를 촘촘히 했다가 정육면체가 도로 23개로
 * 돌아간 것이 이걸 안 했을 때였다.
 */
const PLANAR_SCALE_STEPS = [0.12, 0.16, 0.2, 0.25, 0.3, 0.36, 0.45, 0.55, 0.7, 0.85, 1]

/**
 * 어느 두 라벨도 안 겹치게 만드는 제일 작은 배율.
 *
 * 두 라벨은 가로로 떨어지거나 세로로 떨어지면 안 겹치므로, 한 쌍이 요구하는
 * 배율은 두 축이 요구하는 것 중 **작은** 쪽이다. 전체는 그중 제일 큰 것.
 */
function separatingScale(
  members: LayoutNode[],
  places: Map<string, PlanarPoint>,
  padding: number,
): number {
  let scale = 1
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]
      const b = members[j]
      const pa = places.get(a.word)!
      const pb = places.get(b.word)!
      const dx = Math.abs(pa.x - pb.x)
      const dy = Math.abs(pa.y - pb.y)
      const needX = dx > 0 ? (a.halfWidth + b.halfWidth + padding) / dx : Infinity
      const needY = dy > 0 ? (a.halfHeight + b.halfHeight + padding) / dy : Infinity
      scale = Math.max(scale, Math.min(needX, needY))
    }
  }
  return scale
}

/** 벌리기를 몇 번 반복할지. 한 번마다 모든 점이 한 걸음씩 움직인다. */
const SPREAD_ROUNDS = 120

/**
 * 평면 그림을 **위상을 안 깨고** 벌린다.
 *
 * Tutte 그림은 그 자체로는 못 쓴다. 안쪽 꼭짓점이 바깥 면 쪽으로 몰려 나오는데,
 * 3-연결을 얻으려고 삼각분할까지 하고 나면 면이 전부 삼각형이라 바깥 테두리가
 * 삼각형이 되고, 열 몇 점이 그 삼각형 안에 겹겹이 몰린다. 라벨을 떼려고 통째로
 * 키우면 상자가 **31배**(13단어 사건), **199배**(11단어)가 됐다.
 *
 * 시뮬레이션의 출발점으로 주는 것도 시도했고 실패했다 — 300틱이 위상을 도로
 * 흩어서 네 날의 숫자가 전부 원위치했다. 힘은 자기가 아는 에너지 최소로 갈 뿐
 * 어디서 출발했는지 기억하지 않는다.
 *
 * 그래서 **한 걸음의 크기를 제한한다.** 어떤 점이 자기와 안 닿은 선까지 거리의
 * 1/3보다 적게 움직이면 그 선을 넘을 수 없고, 모든 점이 그 규칙을 지키면 어떤
 * 선도 다른 선을 넘지 못한다 — 평면성이 **보장**된다(PrEd의 논거). 그러니 밀되
 * 그만큼만 민다. 교차를 다시 셀 필요조차 없지만, 부르는 쪽은 어차피 센다.
 */
function spreadPlanar(
  members: LayoutNode[],
  links: LayoutLink[],
  places: Map<string, PlanarPoint>,
  padding: number,
): void {
  // 출발 크기는 라벨들이 실제로 차지하는 넓이에서 잡는다 — 다른 사건과 같은 자다.
  let area = 0
  for (const n of members) area += (n.halfWidth * 2 + padding) * (n.halfHeight * 2 + padding)
  const span = Math.sqrt(area * LOCAL_SLACK)

  for (const node of members) {
    const point = places.get(node.word)!
    node.x = point.x * span
    node.y = point.y * span
  }

  const at = new Map(members.map((n) => [n.word, n]))

  for (let round = 0; round < SPREAD_ROUNDS; round++) {
    const step = members.map(() => ({ x: 0, y: 0 }))

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]
        const b = members[j]
        const dx = (b.x ?? 0) - (a.x ?? 0)
        const dy = (b.y ?? 0) - (a.y ?? 0)
        const distance = Math.hypot(dx, dy) || 1e-9
        // 두 라벨이 안 겹치려면 이만큼은 떨어져야 한다. 대각선으로 재는 것은
        // 방향을 모르기 때문이고, 넉넉한 쪽으로 틀리는 편이 낫다.
        const want = Math.hypot(a.halfWidth + b.halfWidth + padding, a.halfHeight + b.halfHeight + padding)
        if (distance >= want) continue
        const push = ((want - distance) / distance) * 0.5
        step[i].x -= dx * push
        step[i].y -= dy * push
        step[j].x += dx * push
        step[j].y += dy * push
      }
    }

    let moved = false
    for (let i = 0; i < members.length; i++) {
      const node = members[i]
      const want = Math.hypot(step[i].x, step[i].y)
      if (want < 0.01) continue

      const limit = nearestEdgeDistance(node, members, links, at) / 3
      const allowed = Math.min(want, limit)
      if (allowed < 0.01) continue

      node.x = (node.x ?? 0) + (step[i].x / want) * allowed
      node.y = (node.y ?? 0) + (step[i].y / want) * allowed
      moved = true
    }
    if (!moved) break
  }
}

/** 이 점에서 자기와 안 닿은 선까지의 최단 거리. 한 걸음의 상한을 정한다. */
function nearestEdgeDistance(
  node: LayoutNode,
  members: LayoutNode[],
  links: LayoutLink[],
  at: Map<string, LayoutNode>,
): number {
  let nearest = Infinity

  for (const link of links) {
    if (link.a === node.word || link.b === node.word) continue
    const a = at.get(link.a)
    const b = at.get(link.b)
    if (!a || !b) continue
    nearest = Math.min(nearest, pointToSegment(node, a, b))
  }

  // 선이 하나도 안 닿는 점이면 다른 점까지의 거리로 대신한다. 상한이 무한이면
  // 한 걸음에 화면 밖으로 나간다.
  if (!Number.isFinite(nearest)) {
    for (const other of members) {
      if (other === node) continue
      nearest = Math.min(nearest, Math.hypot((other.x ?? 0) - (node.x ?? 0), (other.y ?? 0) - (node.y ?? 0)))
    }
  }
  return Number.isFinite(nearest) ? nearest : 1
}

function pointToSegment(p: LayoutNode, a: LayoutNode, b: LayoutNode): number {
  const ax = a.x ?? 0
  const ay = a.y ?? 0
  const dx = (b.x ?? 0) - ax
  const dy = (b.y ?? 0) - ay
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (((p.x ?? 0) - ax) * dx + ((p.y ?? 0) - ay) * dy) / length))
  return Math.hypot((p.x ?? 0) - (ax + t * dx), (p.y ?? 0) - (ay + t * dy))
}

/** 라벨 상자를 다 감싸는 넓이. 상자를 얼마나 키웠는지 재는 자다. */
function areaOf(members: LayoutNode[]): number {
  const box = crop(members)
  return box.width * box.height
}

/**
 * 평면으로 만드느라 뺄 수 있는 간선의 최대 개수. 하루의 사건 중 비평면인 것은
 * 08-02의 전당대회 하나이고 왜곡도가 2이므로, 3은 여유다.
 */
const MAX_EDGES_DROPPED = 3

// 맞바꿈을 몇 번이나 훑을지. 개선이 없으면 그전에 멈추므로 상한일 뿐이다.
const UNTANGLE_ROUNDS = 4
// 맞바꾼 뒤 충돌만 푸는 반복 횟수.
const RELAX_TICKS = 24

/**
 * 위치를 직접 밀어 겹침만 푼다. d3를 다시 돌리지 않는 이유는 링크와 척력이
 * 방금 만든 배열을 도로 흐트러뜨리기 때문이다 — 여기서 원하는 것은 자리를
 * 바꾼 두 라벨이 이웃을 밀어내는 것뿐이다.
 */
function relax(members: LayoutNode[], padding: number): void {
  for (let tick = 0; tick < RELAX_TICKS; tick++) {
    let moved = false
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]
        const b = members[j]
        const dx = (b.x ?? 0) - (a.x ?? 0)
        const overlapX = a.halfWidth + b.halfWidth + padding - Math.abs(dx)
        if (overlapX <= 0) continue
        const dy = (b.y ?? 0) - (a.y ?? 0)
        const overlapY = a.halfHeight + b.halfHeight + padding - Math.abs(dy)
        if (overlapY <= 0) continue

        moved = true
        if (overlapX < overlapY) {
          const push = (dx < 0 ? -overlapX : overlapX) * 0.5
          a.x = (a.x ?? 0) - push
          b.x = (b.x ?? 0) + push
        } else {
          const push = (dy < 0 ? -overlapY : overlapY) * 0.5
          a.y = (a.y ?? 0) - push
          b.y = (b.y ?? 0) + push
        }
      }
    }
    if (!moved) return
  }
}

/** 중심-중심 직선으로 셌을 때 서로 교차하는 엣지 쌍의 수. */
function countCrossings(members: LayoutNode[], links: LayoutLink[]): number {
  const at = new Map(members.map((n) => [n.word, n]))
  let count = 0
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const p = links[i]
      const q = links[j]
      // 끝점을 공유하는 두 선은 단어 위에서 만나는 것이지 교차가 아니다.
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue
      const a = at.get(p.a)!
      const b = at.get(p.b)!
      const c = at.get(q.a)!
      const d = at.get(q.b)!
      if (segmentsCross(a, b, c, d)) count++
    }
  }
  return count
}

interface Point {
  x?: number
  y?: number
}

function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const side = (o: Point, a: Point, b: Point) =>
    ((a.x ?? 0) - (o.x ?? 0)) * ((b.y ?? 0) - (o.y ?? 0)) -
    ((a.y ?? 0) - (o.y ?? 0)) * ((b.x ?? 0) - (o.x ?? 0))
  const d1 = side(p3, p4, p1)
  const d2 = side(p3, p4, p2)
  const d3 = side(p1, p2, p3)
  const d4 = side(p1, p2, p4)
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0
}

function anyOverlap(members: LayoutNode[], padding: number): boolean {
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]
      const b = members[j]
      if (
        Math.abs((a.x ?? 0) - (b.x ?? 0)) < a.halfWidth + b.halfWidth + padding &&
        Math.abs((a.y ?? 0) - (b.y ?? 0)) < a.halfHeight + b.halfHeight + padding
      ) {
        return true
      }
    }
  }
  return false
}

function simulateLocally(
  members: LayoutNode[],
  links: LayoutLink[],
  padding: number,
  ticks: number,
  seed: number,
): void {
  // 상자는 라벨들이 실제로 차지하는 넓이에서 잡는다. 캔버스 크기에서 나눠 주면
  // 단어가 적은 사건이 큰 상자 안에서 흩어지고, 그 흩어짐이 그대로 구역 사이의
  // 빈 공간이 된다.
  let area = 0
  let widest = 0
  let tallest = 0
  for (const n of members) {
    area += (n.halfWidth * 2 + padding) * (n.halfHeight * 2 + padding)
    widest = Math.max(widest, n.halfWidth * 2)
    tallest = Math.max(tallest, n.halfHeight * 2)
  }
  const roomy = area * LOCAL_SLACK
  const width = Math.max(Math.sqrt(roomy * LOCAL_ASPECT), widest + padding * 2)
  const height = Math.max(roomy / width, tallest + padding * 2)

  members.forEach((n, i) => {
    Object.assign(n, initialPosition(i, members.length, width, height, padding))
  })

  const simulation = forceSimulation(members)
    .randomSource(seededRandom(seed))
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .id((n) => n.word)
        // Strongly associated words sit closer, which is the whole point of
        // drawing edges at all; the size term keeps big labels from being
        // pulled on top of each other.
        .distance((l) => {
          const a = l.source as LayoutNode
          const b = l.target as LayoutNode
          return (a.halfWidth + b.halfWidth + 24) * (1.3 - 0.5 * clamp01(l.npmi))
        })
        .strength((l) => 0.15 + 0.55 * clamp01(l.npmi)),
    )
    // Bigger words claim more room. Capping the range matters more than the
    // strength does: let repulsion act across the whole box and the outermost
    // words are pushed into the bounds clamp, where they pile up on the wall.
    .force(
      'charge',
      forceManyBody<LayoutNode>()
        .strength((n) => -35 - n.halfWidth * 2.0)
        .distanceMax(Math.max(width, height) / 2),
    )
    .force('collide', rectCollide(padding, 0.8))
    // 전역 배치일 때보다 세다. 구역은 촘촘할수록 좋다 — 사건 안의 여백은 이제
    // 사건 사이의 여백과 경쟁하고, 그 둘이 비슷해지면 구역이 안 읽힌다.
    .force('x', forceX<LayoutNode>(width / 2).strength(0.08))
    .force('y', forceY<LayoutNode>(height / 2).strength(0.08))

  // Run the whole thing synchronously and paint once. An animated settle looks
  // busy on a page whose point is to be read, and a fixed tick count is what
  // makes the same day render the same picture twice.
  simulation.stop()
  simulation.alpha(1).alphaDecay(1 - Math.pow(0.001, 1 / ticks))

  for (let i = 0; i < ticks; i++) {
    simulation.tick()
    clampToBounds(members, width, height, padding)
  }
}

/**
 * 라벨 박스들을 딱 감싸는 상자. 여유를 두지 않는다 — 구역 사이의 간격은 패킹이
 * gutter로 주고, 여기서도 여유를 두면 그 간격이 두 번 더해져 구역이 실제보다
 * 멀어 보인다.
 */
function crop(members: LayoutNode[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of members) {
    minX = Math.min(minX, (n.x ?? 0) - n.halfWidth)
    minY = Math.min(minY, (n.y ?? 0) - n.halfHeight)
    maxX = Math.max(maxX, (n.x ?? 0) + n.halfWidth)
    maxY = Math.max(maxY, (n.y ?? 0) + n.halfHeight)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// --- B단계 -----------------------------------------------------------------

/**
 * 다리로 이어진 사건들이 서로 옆에 놓이도록 순서를 다시 짠다.
 *
 * 넓이순으로만 채우면 다리 하나가 화면을 대각선으로 가로지른다 — 측정하면
 * 엣지 최대 길이가 208px에서 719px로 뛰었고, 07-31에 남은 교차 3개는 전부
 * 다리가 낀 것이었다. 다리는 "두 이야기에 걸친 단어"라는 정보라서 없앨 수 없고,
 * 없앨 것은 그 길이다.
 *
 * 넓이순으로 시작해, 이미 놓인 것들과 다리가 제일 많은 사건을 다음에 놓는다.
 * 다리가 없으면 남은 것 중 제일 넓은 것. 하루의 제일 큰 이야기가 여전히
 * 처음이고, 동수는 첫 단어로 깨므로 결정적이다.
 */
function orderForPacking(
  boxes: LaidOutEvent[],
  links: LayoutLink[],
  eventOf: Map<string, number>,
): LaidOutEvent[] {
  if (boxes.length < 3) return boxes

  const bridges = new Map<number, Map<number, number>>()
  for (const l of links) {
    const a = eventOf.get(l.a)
    const b = eventOf.get(l.b)
    if (a === undefined || b === undefined || a === b) continue
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const held = bridges.get(from) ?? new Map<number, number>()
      held.set(to, (held.get(to) ?? 0) + 1)
      bridges.set(from, held)
    }
  }
  if (bridges.size === 0) return boxes

  const remaining = [...boxes]
  const out: LaidOutEvent[] = [remaining.shift()!]
  const placed = new Set<number>([out[0].id])

  while (remaining.length > 0) {
    let bestIndex = 0
    let bestTies = 0
    for (let i = 0; i < remaining.length; i++) {
      let ties = 0
      for (const [to, count] of bridges.get(remaining[i].id) ?? []) {
        if (placed.has(to)) ties += count
      }
      // remaining은 이미 넓이순이므로, 동수일 때 앞을 지키면 넓은 쪽이 이긴다.
      if (ties > bestTies) {
        bestTies = ties
        bestIndex = i
      }
    }
    const next = remaining.splice(bestIndex, 1)[0]
    placed.add(next.id)
    out.push(next)
  }

  return out
}

interface Spot {
  x: number
  y: number
  /** 이 상자가 속한 선반. 가운데 정렬이 선반 단위로 이뤄지므로 필요하다. */
  shelf: number
}

interface Packing {
  spots: Spot[]
  /** 선반마다 실제로 쓰인 폭. */
  shelfWidths: number[]
  width: number
  height: number
}

/**
 * 상자들을 폭에 채운다 — 선반(shelf) 방식.
 *
 * 한 상자가 폭보다 넓으면 넘치도록 둔다. 뷰포트는 그려진 것에 맞춰 잘리고 svg는
 * max-w-full로 축소되므로, 넘치는 것보다 억지로 줄이는 쪽이 더 나쁘다.
 */
function shelfPack(
  sizes: { width: number; height: number }[],
  width: number,
  gutter: number,
): Packing {
  const spots: Spot[] = []
  const shelfWidths: number[] = []

  // 한 상자가 안 들어가면 **새 선반으로 넘어가고, 앞 선반은 다시 안 본다**
  // (next-fit). 그래서 두 단어짜리 사건이 자기 선반 한 줄을 통째로 차지하는 일이
  // 생긴다 — 2026-07-31 데스크톱의 `로보틱스—제미나이`가 그렇다.
  //
  // **자리가 남은 앞 선반에 끼워 넣는 것(first-fit)은 재보고 안 쓰기로 했다.**
  // 폰 높이를 5~11% 줄이지만(08-01이 1811에서 1619) 폰 08-03의 `xBr`를 6에서
  // 9로 올린다. 앞 선반으로 되돌아가 끼우는 것이 곧 `orderForPacking`이 다리를
  // 보고 옆에 붙여 둔 이웃을 떼어 놓는 것이기 때문이다. 버리는 한 줄은 미용
  // 문제고 다리가 남의 사건을 자르는 것은 읽기 문제라, 바꿀 것이 아니다.
  const shelves: { used: number; height: number }[] = []

  for (const size of sizes) {
    let shelf = shelves.length - 1
    if (shelf < 0 || (shelves[shelf].used > 0 && shelves[shelf].used + size.width > width)) {
      shelf = shelves.length
      shelves.push({ used: 0, height: 0 })
    }
    const here = shelves[shelf]
    spots.push({ x: here.used, y: 0, shelf })
    here.used += size.width + gutter
    here.height = Math.max(here.height, size.height)
  }

  // 선반의 y는 앞 선반들의 높이가 다 정해진 뒤에야 알 수 있다.
  let y = 0
  const shelfTops = shelves.map((s) => {
    const top = y
    y += s.height + gutter
    return top
  })
  for (const spot of spots) spot.y = shelfTops[spot.shelf]
  shelves.forEach((s, i) => {
    shelfWidths[i] = s.used - gutter
  })

  // **홀수 선반은 좌우를 뒤집는다** — 뱀이 기어가듯.
  //
  // `orderForPacking`이 다리로 이어진 사건을 순서상 이웃에 놓아 두는데, 선반이
  // 넘어가는 자리에서는 그 이웃 둘이 화면의 왼쪽 끝과 오른쪽 끝으로 갈라진다.
  // 순서상 붙여 놓은 것이 2차원에서는 제일 멀어지는 것이다. 뒤집으면 넘김 지점이
  // 위아래로 붙는다. 상수가 없고, 구역의 크기도 개수도 안 건드린다.
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i]
    if (spot.shelf % 2 === 0) continue
    spot.x = shelfWidths[spot.shelf] - (spot.x + sizes[i].width)
  }

  return {
    spots,
    shelfWidths,
    width: Math.max(0, ...shelfWidths),
    height: sizes.length === 0 ? 0 : y - gutter,
  }
}

/** 뒤집기가 더 이상 아무 상자도 안 움직일 때까지 도는 횟수의 상한. */
const FACE_ROUNDS = 4

/**
 * 다리를 든 단어가 상대 구역을 **바라보는 쪽**에 오도록 상자를 거울처럼 뒤집는다.
 *
 * 이걸 붙인 이유는 재고 나서다. `xBr`(다리가 낀 교차)를 쪼개 보면 다리끼리
 * 엇갈린 것은 여덟 칸 통틀어 1개, 남의 구역을 가로지른 것은 3개뿐이고, **나머지는
 * 전부 다리가 자기 구역의 내부 선을 자르고 나간 것**이다 — 데스크톱 08-03은
 * 14개 중 14개가 그것이었다. 즉 이건 구역을 어떤 **순서로** 늘어놓느냐의 문제가
 * 아니어서 `orderForPacking`으로는 손댈 수 없다. 민주당이 12단어짜리 전당대회
 * 덩어리 한가운데 앉아 있으면, 그 단어에서 나가는 다리는 어느 쪽으로 가든 그
 * 사건의 바큇살을 가로지른다.
 *
 * 뒤집기를 고른 것도 측정이 아니라 **성질** 때문이다. 거울 반사는 등거리변환이라
 * 상자의 크기가 그대로여서 패킹을 다시 하지 않아도 되고, 구역 **안**의 교차수와
 * 라벨 겹침을 한 개도 바꿀 수 없다(그 둘은 거리와 방향으로만 정해진다). 바꿀 수
 * 있는 것은 바깥과의 관계뿐이다 — 이 문제에만 듣고 다른 것은 건드릴 수 없는
 * 지렛대라서, 회귀를 걱정할 자리가 구조적으로 없다.
 *
 * 비용은 다리 길이의 합이다. 교차수를 직접 세지 않는 것은 근사가 아니라 같은
 * 것이다: 다리가 짧아지는 방향이 곧 그 단어가 상대 쪽 모서리로 가는 방향이고,
 * 자기 사건을 가로지르지 않는 것도 바로 그 자리다.
 *
 * 상대 구역도 뒤집히므로 한 번으로는 안 끝난다. 아무 상자도 안 움직일 때까지
 * 돌리고, 동수면 뒤집지 않는 쪽이 이기므로 결정적이다.
 */
function faceBridges(
  boxes: LaidOutEvent[],
  spots: Spot[],
  links: LayoutLink[],
  eventOf: Map<string, number>,
): void {
  const byWord = new Map<string, LayoutNode>()
  for (const box of boxes) for (const m of box.members) byWord.set(m.word, m)

  // 사건 id → 그 사건의 단어가 든 다리들. 양끝이 다 구역 안에 있다 — 선을 가진
  // 단어는 반드시 사건을 받으므로(혼자면 혼자짜리 구역), 다리의 상대가 무연결
  // 띠에 있는 경우는 없다.
  const held = new Map<number, { mine: LayoutNode; theirs: LayoutNode }[]>()
  for (const l of links) {
    const a = eventOf.get(l.a)
    const b = eventOf.get(l.b)
    if (a === undefined || b === undefined || a === b) continue
    const na = byWord.get(l.a)
    const nb = byWord.get(l.b)
    if (!na || !nb) continue
    for (const [id, mine, theirs] of [
      [a, na, nb],
      [b, nb, na],
    ] as const) {
      const list = held.get(id)
      if (list) list.push({ mine, theirs })
      else held.set(id, [{ mine, theirs }])
    }
  }
  if (held.size === 0) return

  for (let round = 0; round < FACE_ROUNDS; round++) {
    let moved = false

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      const bridges = held.get(box.id)
      if (!bridges) continue

      const cx = spots[i].x + box.width / 2
      const cy = spots[i].y + box.height / 2
      const cost = (flipX: boolean, flipY: boolean) => {
        let sum = 0
        for (const { mine, theirs } of bridges) {
          const x = flipX ? 2 * cx - mine.x! : mine.x!
          const y = flipY ? 2 * cy - mine.y! : mine.y!
          sum += Math.hypot(x - theirs.x!, y - theirs.y!)
        }
        return sum
      }

      // 항등을 먼저 재고 이후는 진짜로 더 나을 때만 이기게 해서, 같은 값이면
      // 뒤집지 않는다.
      let bestX = false
      let bestY = false
      let best = cost(false, false)
      for (const [flipX, flipY] of [
        [true, false],
        [false, true],
        [true, true],
      ] as const) {
        const c = cost(flipX, flipY)
        if (c < best) {
          best = c
          bestX = flipX
          bestY = flipY
        }
      }
      if (!bestX && !bestY) continue

      for (const m of box.members) {
        if (bestX) m.x = 2 * cx - m.x!
        if (bestY) m.y = 2 * cy - m.y!
      }
      moved = true
    }

    if (!moved) break
  }
}

interface FlowSize {
  width: number
  height: number
  /** 줄마다 쓰인 폭과, 그 줄에 속한 노드. 가운데 정렬용. */
  rows: { width: number; nodes: LayoutNode[] }[]
}

/**
 * 라벨을 한 줄씩 흘려 놓는다. 사건 구역이 아니라 **남은 단어들**을 위한 것이므로
 * 간격은 단어 간격(padding)이지 구역 간격(gutter)이 아니다 — 이 단어들은 서로
 * 아무 관계도 아니지만 서로에 대해서는 다 같은 지위라, 사건들처럼 벌려 놓으면
 * 그 여백이 있지도 않은 구분을 주장하게 된다.
 */
function flowRows(
  nodes: LayoutNode[],
  width: number,
  padding: number,
  top: number,
): FlowSize {
  const rows: { width: number; nodes: LayoutNode[] }[] = []
  let current: LayoutNode[] = []
  let x = 0
  let y = top
  let rowHeight = 0

  const close = () => {
    if (current.length === 0) return
    rows.push({ width: x - padding, nodes: current })
  }

  for (const n of nodes) {
    const w = n.halfWidth * 2
    if (x > 0 && x + w > width) {
      close()
      current = []
      y += rowHeight + padding
      x = 0
      rowHeight = 0
    }
    n.x = x + n.halfWidth
    n.y = y + n.halfHeight
    current.push(n)
    x += w + padding
    rowHeight = Math.max(rowHeight, n.halfHeight * 2)
  }
  close()

  // 줄 안에서 세로 가운데로. 글자 크기가 14부터 64까지 섞이므로 위에 맞추면
  // 큰 단어 아래로 빈 칸이 생겨 줄이 어긋나 보인다.
  for (const row of rows) {
    const tallest = Math.max(...row.nodes.map((n) => n.halfHeight * 2))
    for (const n of row.nodes) {
      n.y = (n.y ?? 0) + (tallest - n.halfHeight * 2) / 2
    }
  }

  return {
    width: Math.max(0, ...rows.map((r) => r.width)),
    height: nodes.length === 0 ? 0 : y + rowHeight - top,
    rows,
  }
}

/** 선반과 줄을 각각 실제로 쓰인 전체 폭 안에서 가운데로 민다. */
function centerRows(
  placed: PlacedNode[],
  regions: EventRegion[],
  packed: Packing,
  boxes: LaidOutEvent[],
  loose: FlowSize,
  content: number,
): void {
  const byWord = new Map(placed.map((n) => [n.word, n]))

  for (let i = 0; i < boxes.length; i++) {
    const shift = round((content - packed.shelfWidths[packed.spots[i].shelf]) / 2)
    if (shift === 0) continue
    regions[i].x = round(regions[i].x + shift)
    for (const member of boxes[i].members) {
      const node = byWord.get(member.word)
      if (node) node.x = round(node.x + shift)
    }
  }

  for (const row of loose.rows) {
    const shift = round((content - row.width) / 2)
    if (shift === 0) continue
    for (const member of row.nodes) {
      const node = byWord.get(member.word)
      if (node) node.x = round(node.x + shift)
    }
  }
}

// --- 선 ---------------------------------------------------------------------

// Gap left between a line and the label it passes. Also what pulls an edge back
// off its own endpoints, since a node's centre is inside its own box.
const LABEL_CLEARANCE = 4
// Below this a surviving piece of line is a speck rather than a connection.
const MIN_SEGMENT = 3

// A blocker sitting almost on top of an end needs an unbounded bulge to clear,
// because the curve is pinned there. Anything past these is treated as if it
// sat here; the ends themselves are already handled by the trim above.
const MIN_BEND_T = 0.15
const MAX_BEND_T = 0.85
// Nothing legible comes of bowing a stroke further than this much of its own
// length — past it the curve reads as a shape rather than as a connection.
const MAX_BOW = 0.55
// A bow computed from the chord can carry the curve into a label the straight
// line never touched, so candidates are sampled rather than trusted. These are
// the fractions of the cap that get tried, nearest first.
const BOW_STEPS = [0.08, 0.16, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1]

// An edge runs centre to centre, so it starts and ends underneath its own two
// labels and may pass under others on the way. The ends are pulled out of their
// own boxes, and anything in between is dodged by bowing the stroke to one
// side — never by cutting it, which is what used to fragment it.
export function routeEdge(
  from: PlacedNode,
  to: PlacedNode,
  nodes: PlacedNode[],
): EdgeCurve | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return null

  // Pull each end out of its own label, so the stroke meets the text rather
  // than starting somewhere inside it.
  const startSpan = boxSpan(from.x, from.y, dx, dy, from)
  const endSpan = boxSpan(from.x, from.y, dx, dy, to)
  const t0 = startSpan ? startSpan[1] : 0
  const t1 = endSpan ? endSpan[0] : 1
  if ((t1 - t0) * length < MIN_SEGMENT) return null

  const x1 = from.x + dx * t0
  const y1 = from.y + dy * t0
  const x2 = from.x + dx * t1
  const y2 = from.y + dy * t1

  const cdx = x2 - x1
  const cdy = y2 - y1
  const chord = Math.hypot(cdx, cdy)
  // Unit normal to the trimmed chord: the one direction the stroke may bow in.
  const ux = -cdy / chord
  const uy = cdx / chord

  const others = nodes.filter((n) => n !== from && n !== to)

  // How far the control point would have to go, each way, to clear everything
  // the straight chord runs into.
  let outward = 0
  let inward = 0
  for (const n of others) {
    const span = boxSpan(x1, y1, cdx, cdy, n)
    if (!span) continue
    const at = clamp((span[0] + span[1]) / 2, MIN_BEND_T, MAX_BEND_T)
    const across = (n.x - x1) * ux + (n.y - y1) * uy
    const reach = Math.abs(n.halfWidth * ux) + Math.abs(n.halfHeight * uy) + LABEL_CLEARANCE
    // A quadratic only reaches 2(1-t)t of its control point's offset at t, so
    // the control point has to be pushed that much further out than the label.
    const gain = 2 * (1 - at) * at
    outward = Math.max(outward, (across + reach) / gain)
    inward = Math.min(inward, (across - reach) / gain)
  }

  // One quadratic bends one way only. Try the cheaper side first, but try the
  // other one too before giving up: whichever side the chord arithmetic prefers
  // can turn out to be the crowded one, and dropping a relationship is a worse
  // outcome than a longer detour. Trying only the cheap side lost 17 of 63
  // edges on 2026-08-01.
  const limit = MAX_BOW * chord
  // Which way the chord arithmetic says is cheaper. It only orders the search:
  // seeding an escalation from that figure instead left a side with no
  // candidates at all whenever the figure already exceeded the cap, and that
  // dropped 18 of the day's 68 edges.
  const outwardFirst = outward <= -inward

  // Straight first, then a sweep out to the cap, taking the cheaper side first
  // at each distance. Ordered by magnitude so the flattest workable stroke wins.
  const candidates: number[] = [0]
  for (const fraction of BOW_STEPS) {
    const size = fraction * limit
    candidates.push(outwardFirst ? size : -size)
    candidates.push(outwardFirst ? -size : size)
  }

  // Take the least intrusive route rather than the first clean one, so that a
  // crowded edge still gets drawn — as the flattest stroke that touches the
  // least text, marked so the caller can fade it.
  let best = bowedCurve(x1, y1, x2, y2, ux, uy, 0, false)
  let bestScore = Number.POSITIVE_INFINITY

  for (const bow of candidates) {
    const curve = bowedCurve(x1, y1, x2, y2, ux, uy, bow, false)
    // Crossing a glyph is much worse than merely grazing the clearance margin,
    // so the two are weighted rather than summed.
    const over = intrusion(curve, others, 0)
    const score = over * 100 + intrusion(curve, others, LABEL_CLEARANCE)
    if (score < bestScore) {
      bestScore = score
      best = { ...curve, clear: over === 0 }
      if (score === 0) break
    }
  }

  return best
}

function bowedCurve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  ux: number,
  uy: number,
  bow: number,
  clear: boolean,
): EdgeCurve {
  return {
    x1: round(x1),
    y1: round(y1),
    cx: round((x1 + x2) / 2 + ux * bow),
    cy: round((y1 + y2) / 2 + uy * bow),
    x2: round(x2),
    y2: round(y2),
    clear,
  }
}

// How much of the curve lands on a label, in sampled points. Sampled because a
// quadratic against an axis-aligned box has no closed form worth the arithmetic
// here, and a count ranks routes where a boolean could only reject them.
function intrusion(curve: EdgeCurve, boxes: PlacedNode[], margin: number): number {
  const steps = 32
  let hits = 0
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const m = 1 - t
    const x = m * m * curve.x1 + 2 * m * t * curve.cx + t * t * curve.x2
    const y = m * m * curve.y1 + 2 * m * t * curve.cy + t * t * curve.y2
    for (const box of boxes) {
      if (
        Math.abs(x - box.x) < box.halfWidth + margin &&
        Math.abs(y - box.y) < box.halfHeight + margin
      ) {
        hits++
        break
      }
    }
  }
  return hits
}

// Where the ray enters and leaves one label's box, as a fraction of the edge.
// The slab method: clip the parameter range against each axis in turn and see
// whether anything survives.
function boxSpan(
  x: number,
  y: number,
  dx: number,
  dy: number,
  box: PlacedNode,
): [number, number] | null {
  let t0 = 0
  let t1 = 1

  const minX = box.x - box.halfWidth - LABEL_CLEARANCE
  const maxX = box.x + box.halfWidth + LABEL_CLEARANCE
  const minY = box.y - box.halfHeight - LABEL_CLEARANCE
  const maxY = box.y + box.halfHeight + LABEL_CLEARANCE

  // A ray parallel to an axis either sits inside that slab for its whole length
  // or misses the box entirely; dividing by zero would say neither.
  if (dx === 0) {
    if (x < minX || x > maxX) return null
  } else {
    const a = (minX - x) / dx
    const b = (maxX - x) / dx
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }

  if (dy === 0) {
    if (y < minY || y > maxY) return null
  } else {
    const a = (minY - y) / dy
    const b = (maxY - y) / dy
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }

  return t0 < t1 ? [t0, t1] : null
}

// --- 커뮤니티 ---------------------------------------------------------------

// Louvain's local-moving phase (Blondel et al. 2008), iterated until no word
// changes community. The aggregation phase is skipped: a day tops out at 70
// words and 60 edges, and on graphs that small the first phase already
// converges to the same partition.
//
// Every node starts alone. Each pass offers each word to the community of each
// neighbour and keeps the move with the largest modularity gain, which for a
// single node reduces to maximising
//
//     (weight from the word into that community) - (community degree * word degree) / 2m
//
// The subtracted term is what stops a hub joining everything it touches: a
// community that is already large has to earn a new member with proportionally
// stronger ties.
//
// Deterministic throughout — words are visited in the order they were drawn,
// which is frequency order, and ties go to the lowest community id.
function detectCommunities(
  nodes: { word: string }[],
  edges: GraphEdge[],
): Map<string, number> {
  const index = new Map<string, number>()
  nodes.forEach((n, i) => index.set(n.word, i))

  const neighbours: { node: number; weight: number }[][] = nodes.map(() => [])
  const degree = new Array(nodes.length).fill(0)
  let totalWeight = 0

  for (const e of edges) {
    const a = index.get(e.a)
    const b = index.get(e.b)
    if (a === undefined || b === undefined || a === b) continue
    // NPMI can in principle be negative; a non-positive weight would make the
    // gain arithmetic meaningless, so the floor keeps every drawn edge a real
    // pull of some size.
    const weight = Math.max(0.01, e.npmi)
    neighbours[a].push({ node: b, weight })
    neighbours[b].push({ node: a, weight })
    degree[a] += weight
    degree[b] += weight
    totalWeight += weight
  }

  const community = nodes.map((_, i) => i)
  const communityDegree = [...degree]
  if (totalWeight === 0) return new Map(nodes.map((n, i) => [n.word, i]))

  const twoM = 2 * totalWeight

  // Converges in a handful of passes at this size; the cap only guarantees
  // termination if two moves ever trade places.
  for (let pass = 0; pass < 20; pass++) {
    let moved = false

    for (let i = 0; i < nodes.length; i++) {
      if (neighbours[i].length === 0) continue

      const from = community[i]
      communityDegree[from] -= degree[i]

      const weightTo = new Map<number, number>()
      weightTo.set(from, 0)
      for (const { node, weight } of neighbours[i]) {
        weightTo.set(community[node], (weightTo.get(community[node]) ?? 0) + weight)
      }

      let best = from
      let bestGain = -Infinity
      for (const [candidate, weight] of weightTo) {
        const gain = weight - (communityDegree[candidate] * degree[i]) / twoM
        if (gain > bestGain || (gain === bestGain && candidate < best)) {
          bestGain = gain
          best = candidate
        }
      }

      communityDegree[best] += degree[i]
      if (best !== from) {
        community[i] = best
        moved = true
      }
    }

    if (!moved) break
  }

  return new Map(nodes.map((n, i) => [n.word, community[i]]))
}

// --- 마무리 -----------------------------------------------------------------

// The viewport is cropped to whatever was actually drawn rather than to a
// nominal canvas, so a category with eight words gets a small frame instead of
// a clump adrift in a large one.
function boundingBox(nodes: PlacedNode[], padding: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.halfWidth)
    minY = Math.min(minY, n.y - n.halfHeight)
    maxX = Math.max(maxX, n.x + n.halfWidth)
    maxY = Math.max(maxY, n.y + n.halfHeight)
  }

  return {
    x: round(minX - padding),
    y: round(minY - padding),
    width: round(maxX - minX + padding * 2),
    height: round(maxY - minY + padding * 2),
  }
}

// A label wider than the box cannot be kept inside it; centring it is the least
// bad outcome, and beats Math.min/Math.max silently inverting the range.
function clampToBounds(nodes: LayoutNode[], width: number, height: number, padding: number): void {
  for (const n of nodes) {
    const marginX = n.halfWidth + padding
    const marginY = n.halfHeight + padding
    n.x = marginX * 2 > width ? width / 2 : clamp(n.x ?? 0, marginX, width - marginX)
    n.y = marginY * 2 > height ? height / 2 : clamp(n.y ?? 0, marginY, height - marginY)
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

// Two decimals is well below a device pixel and keeps the emitted SVG stable
// enough to diff.
function round(value: number): number {
  return Math.round(value * 100) / 100
}
