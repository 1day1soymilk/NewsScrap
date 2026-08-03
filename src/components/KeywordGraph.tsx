import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { computeGraphLayout, nextLayoutWidth } from './graphLayout'
import type { MeasuredWord } from './graphLayout'
import { computeFontSizes } from './wordCloudLayout'
import { UNFOCUSED_OPACITY } from '../lib/focus'
import { NEUTRAL_INK, sectionColor } from '../lib/sectionColors'
import type { KeywordGraphData } from '../lib/types'
import type { Surge } from '../lib/surge'

// Must match the font the <text> elements below actually render in, or every
// measured width is wrong and labels overlap.
const FONT_FAMILY = 'sans-serif'

// 높이는 여기서 정하지 않는다. 배치가 주어진 폭에 사건 구역을 채우고 필요한
// 만큼 높아지므로, 높이는 입력이 아니라 결과다 — layout.bounds가 답한다.
//
// 이 자리에는 MIN_HEIGHT / MAX_HEIGHT / HEIGHT_RATIO와, 좁은 화면을 위한
// NARROW_WIDTH / NARROW_HEIGHT_PER_WORD / NARROW_MAX_HEIGHT 분기가 있었다.
// 그 분기가 있었던 이유는 폭에서 높이를 지어내면 폰에서 상자가 턱없이 모자라기
// 때문인데(358px에서 358x279가 나왔고 충돌이 해소되지 않아 라벨이 서로 위에
// 얹혔다 — 2026-07-31에서 실제로 한 쌍이 겹쳐 있었다), 높이를 지어내지 않으면
// 그 문제 자체가 없다. 좁은 화면에서는 구역이 세로로 쌓이고 페이지가 스크롤된다.
const FALLBACK_WIDTH = 700

// scoring_weights.demote_factor is 0.3, but the RPC ships only the boolean
// `faded`, so this is a second copy of that number by necessity. Kept slightly
// higher because 0.3 on a white background is barely legible.
const FADED_OPACITY = 0.38
// Everything outside the focused word's neighbourhood. Shared with EventList,
// which recedes the same way when a word is picked, so the two cannot drift to
// different strengths of the same gesture.

// Section inks live in src/lib/sectionColors.ts because CategoryTabs draws the
// same six as the graph's colour key, and the two have to be the same values.
// They are var() references into the @theme block in src/index.css, which is the
// single source of truth: holding hex here is what let the old palette drift
// into an 80-degree band without anything noticing.
const NEUTRAL_COLOR = NEUTRAL_INK
// One neutral grey for every edge, in both views.
//
// Edges used to be stroked with a gradient between their two endpoints' section
// colours, so a crossing could be read without tracing it. It worked, and it
// cost too much: it put a third layer of colour on a canvas that already spends
// hue on 70 words, and lines are the one element here that carries no meaning of
// its own — the words at each end already say which sections are involved.
const EDGE_COLOR = 'var(--color-edge)'
// Applied to an edge that had to be routed under a label because the field was
// too crowded for any single curve to miss everything.
const CROWDED_EDGE_FADE = 0.5

// 강약을 벌리는 구간. 실측 NPMI는 0.31~1.00이고, 0부터 정규화하면 화면에 실제로
// 나오는 값들이 위쪽 3분의 2에 몰려 서로 구별되지 않는다 — 굵기가 1.1px 폭 안에서
// 놀았고 투명도가 0.26~0.48이었다. 개별로는 안 보이고 전체로는 소음이었다.
//
// 강한 결합은 진하게, 약한 결합은 옅게. 선의 세기가 이 캔버스에서 NPMI가 하는
// 유일한 일이다 — 단어 품질 신호로는 이미 탈락했다.
const EDGE_NPMI_FLOOR = 0.3
const EDGE_WIDTH_MIN = 0.8
const EDGE_WIDTH_SPAN = 2.2
const EDGE_OPACITY_MIN = 0.15
const EDGE_OPACITY_SPAN = 0.7
// 선택되지 않은 관계. 노드가 물러나는 세기와 같은 값이지만 같은 상수는 아니다 —
// 저쪽은 글자가 읽히지 않을 만큼 물러나는 것이고 이쪽은 선이 배경이 되는 것이다.
const EDGE_UNSELECTED_OPACITY = 0.1

/** 0(약함)에서 1(강함)로 편 결합 세기. */
function edgeStrength(npmi: number): number {
  const t = (npmi - EDGE_NPMI_FLOOR) / (1 - EDGE_NPMI_FLOOR)
  return t < 0 ? 0 : t > 1 ? 1 : t
}

// Day-over-day movement. One glyph for both "new" and "surging": a word that
// was not there yesterday is the limiting case of one that grew, and two
// symbols would need a legend to tell apart what the tooltip already says.
const SURGE_MARK = '▲'
const SURGE_COLOR = 'var(--color-surge)'
const SURGE_GAP = 3
const SURGE_MIN_SIZE = 10
const SURGE_MAX_SIZE = 16
// The viewport crops to the label boxes, and a marker sits outside its own
// label. Without this the rightmost surging word loses its mark to the crop.
const SURGE_ALLOWANCE = SURGE_GAP + SURGE_MAX_SIZE + 4

let measureContext: CanvasRenderingContext2D | null | undefined

// jsdom does not implement canvas, so this falls back to an estimate rather
// than throwing. Only unit tests take that path; the browser always measures.
function measureTextWidth(text: string, fontSize: number): number {
  if (measureContext === undefined) {
    measureContext = document.createElement('canvas').getContext('2d')
  }
  if (!measureContext) return text.length * fontSize * 0.95
  measureContext.font = `${fontSize}px ${FONT_FAMILY}`
  return measureContext.measureText(text).width
}

interface KeywordGraphProps {
  graph: KeywordGraphData
  selectedWord: string | null
  onWordClick: (word: string) => void
  /** Section colours only mean something in the all-categories view. */
  colorByCategory: boolean
  /** Words that grew against the previous collected day. Empty is normal. */
  surges: Map<string, Surge>
  /**
   * Whatever goes above the canvas — the event list, in practice. A slot
   * rather than a component of its own so the list and the surge key share one
   * bordered row; two stacked bordered rows read as two unrelated blocks.
   */
  header?: ReactNode
  /**
   * The words an event or a bridge selection holds lit. Null means no such
   * selection, and the word focus below runs as it always has.
   *
   * An event lights its members and **not their neighbours**: a word selection
   * expands to neighbours, but an event already is a neighbourhood, and
   * expanding it would light the very event across a bridge that the merge
   * rule declined to join — letting the display overturn that judgement.
   */
  focusWords?: Set<string> | null
  /**
   * The uncut Louvain partition, handed up so the event list is built from the
   * same one the cohesion force ran on. Called on every resize; the assignment
   * is a function of topology alone, so the value does not change and the
   * caller compares content before acting on it.
   */
  onCommunities?: (communities: Map<string, number>) => void
}

export function KeywordGraph({
  graph,
  selectedWord,
  onWordClick,
  colorByCategory,
  surges,
  header,
  focusWords = null,
  onCommunities,
}: KeywordGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)

  // The first measurement is taken whatever the threshold says. Width starts at
  // FALLBACK_WIDTH, so a real container landing within 8px of it would otherwise
  // be drawn at a made-up width forever.
  const measuredOnce = useRef(false)

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      setWidth((current) => {
        const next = nextLayoutWidth(current, measured, measuredOnce.current ? undefined : 0)
        if (next === null) return current
        measuredOnce.current = true
        return next
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 레이아웃은 렌더 경로 안에서 도는 가장 비싼 계산이다. 리사이즈 중에는 뒤로
  // 미뤄, 다시 그리는 동안에도 페인트가 막히지 않게 한다. 폭이 바뀌지 않는
  // 보통의 상호작용(단어 클릭 등)에서는 값이 같으므로 아무 차이도 없다.
  const layoutWidth = useDeferredValue(width)

  const measured = useMemo<MeasuredWord[]>(() => {
    // computeFontSizes is the word cloud's, reused unchanged: size stays
    // proportional to headline count, which is the one thing a reader already
    // understands. The sieve decides who is drawn, never how big.
    const sized = computeFontSizes(graph.nodes.map((n) => ({ word: n.word, count: n.count })))
    const fadedByWord = new Map(graph.nodes.map((n) => [n.word, n.faded]))

    return sized.map((s) => ({
      word: s.text,
      count: s.count,
      fontSize: s.fontSize,
      textWidth: measureTextWidth(s.text, s.fontSize),
      faded: fadedByWord.get(s.text) ?? false,
    }))
  }, [graph.nodes])

  const layout = useMemo(
    () => computeGraphLayout(measured, graph.edges, { width: layoutWidth }),
    [measured, graph.edges, layoutWidth],
  )

  useEffect(() => {
    onCommunities?.(layout.communities)
  }, [layout.communities, onCommunities])

  // Focus mode: the clicked word and whatever shares a headline with it stay
  // lit, everything else recedes. Empty when nothing is selected.
  const neighbors = useMemo(() => {
    const set = new Set<string>()
    if (!selectedWord) return set
    for (const edge of graph.edges) {
      if (edge.a === selectedWord) set.add(edge.b)
      if (edge.b === selectedWord) set.add(edge.a)
    }
    return set
  }, [graph.edges, selectedWord])

  const signalsByWord = useMemo(
    () => new Map(graph.nodes.map((n) => [n.word, n])),
    [graph.nodes],
  )

  if (graph.nodes.length === 0) {
    return <p className="text-center text-ink-muted">아직 수집된 데이터가 없습니다.</p>
  }

  function nodeOpacity(word: string, faded: boolean): number {
    const base = faded ? FADED_OPACITY : 1
    // 사건이나 다리가 선택되면 살아남는 집합이 밖에서 정해져 온다. 그럴 때는
    // 이웃으로 넓히지 않는다 — 사건은 그 자체가 이미 이웃 집합이다.
    if (focusWords) return focusWords.has(word) ? base : UNFOCUSED_OPACITY
    if (!selectedWord) return base
    if (word === selectedWord || neighbors.has(word)) return base
    return UNFOCUSED_OPACITY
  }

  // 엣지는 양끝이 다 살아 있을 때만 살아 있다. 단어 포커스일 때의 규칙은 그대로
  // 둔다 — 이웃끼리 잇는 선까지 살리면 지금 화면이 달라진다.
  function edgeLit(a: string, b: string): boolean {
    if (focusWords) return focusWords.has(a) && focusWords.has(b)
    if (!selectedWord) return true
    return a === selectedWord || b === selectedWord
  }

  // Only markers on words that were actually drawn can be clipped, so the
  // allowance is skipped entirely on a day with no movement rather than padding
  // every graph for a case that is not on screen.
  const marked = layout.nodes.some((node) => surges.has(node.word))
  const pad = marked ? SURGE_ALLOWANCE : 0
  // The svg is sized to its own viewBox so nothing is scaled; both have to grow
  // together or expanding the box would shrink the graph inside it.
  const view = {
    x: layout.bounds.x - pad,
    y: layout.bounds.y - pad,
    width: layout.bounds.width + pad * 2,
    height: layout.bounds.height + pad * 2,
  }

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-5xl">
      {/* One rule of caption above the canvas rather than two centred lines
          floating in the gap between the toolbar and the first word — that gap
          was most of what made the top of the page read as empty.
          The header slot holds the event list. The surge key is here for its
          own reason: the mark is small and sits off the side of a word, so
          without a key it reads as a rendering artefact. */}
      {(header || marked) && (
        <div className="mb-4 border-b border-line pb-2">
          {header}
          {marked && (
            <p className="mt-1 text-right text-xs text-ink-faint">
              <span className="mr-1" style={{ color: SURGE_COLOR }}>
                {SURGE_MARK}
              </span>
              직전 수집일 대비 급상승
            </p>
          )}
        </div>
      )}

      {/* Cropped to the labels rather than to the canvas the simulation ran in,
          and rendered at that box's own size so nothing is magnified. A day
          with eight words in one category gets a small frame instead of a clump
          adrift in a large one. */}
      <svg
        width={view.width}
        height={view.height}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        role="group"
        aria-label="키워드 관계망"
        // h-auto matters: with only max-w-full the width shrinks to the
        // container while the height attribute stays at the box the layout ran
        // in, so the drawing is letterboxed inside a too-tall element and the
        // page shows a band of empty canvas above and below it — 141px of it on
        // a phone. Letting the height follow the width keeps the crop tight.
        className="mx-auto block h-auto max-w-full select-none"
      >
        <g>
          {layout.edges.map((edge) => {
            // One relationship, one stroke. This used to be several <line>s per
            // edge, the leftovers of cutting each label box out of a straight
            // line, and several collinear dashes read as several relationships.
            const curve = edge.curve
            if (!curve) return null
            const touchesSelection = edgeLit(edge.a, edge.b)
            const strength = edgeStrength(edge.npmi)
            return (
              <path
                key={`${edge.a}--${edge.b}`}
                d={`M${curve.x1} ${curve.y1}Q${curve.cx} ${curve.cy} ${curve.x2} ${curve.y2}`}
                fill="none"
                style={{ stroke: EDGE_COLOR }}
                strokeLinecap="round"
                strokeWidth={EDGE_WIDTH_MIN + EDGE_WIDTH_SPAN * strength}
                // Stronger association draws a heavier, darker line; that is the
                // only job NPMI has here, having failed as a word-quality signal.
                //
                // A stroke the routing could not keep off the labels is drawn
                // fainter, so it stops competing with the words it runs under.
                // That is the price of never dropping a relationship.
                strokeOpacity={
                  (touchesSelection
                    ? EDGE_OPACITY_MIN + EDGE_OPACITY_SPAN * strength
                    : EDGE_UNSELECTED_OPACITY) * (curve.clear ? 1 : CROWDED_EDGE_FADE)
                }
              />
            )
          })}
        </g>
        <g>
          {layout.nodes.map((node) => {
            const signals = signalsByWord.get(node.word)
            const color = colorByCategory ? categoryColor(signals) : NEUTRAL_COLOR
            const surge = surges.get(node.word)
            const opacity = nodeOpacity(node.word, node.faded)

            return (
              // <title> sits on the wrapper, not inside <text>: as a child of
              // <text> it becomes part of that element's text content, and every
              // selector matching a word exactly would stop matching. Browsers
              // walk up to the nearest <title>, so the tooltip is unaffected.
              <g key={node.word}>
                <title>{tooltip(node.word, node.count, signals, surge)}</title>
                {surge && (
                  // Its own <text>, not part of the label: appending it to the
                  // word would change that element's text content, and every
                  // selector that matches a word exactly would stop matching.
                  // aria-hidden because the label below already says it in
                  // words — a screen reader does not want "검은색 위쪽 삼각형".
                  <text
                    x={node.x + node.halfWidth + SURGE_GAP}
                    y={node.y - node.halfHeight}
                    textAnchor="start"
                    dominantBaseline="central"
                    fontSize={clampSize(node.fontSize * 0.45)}
                    fontFamily={FONT_FAMILY}
                    style={{ fill: SURGE_COLOR }}
                    opacity={opacity}
                    aria-hidden="true"
                    className="select-none"
                  >
                    {SURGE_MARK}
                  </text>
                )}
                <text
                  x={node.x}
                  y={node.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={node.fontSize}
                  fontFamily={FONT_FAMILY}
                  style={{ fill: color }}
                  opacity={opacity}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.word}, ${node.count}건${surgeLabel(surge)}`}
                  aria-pressed={node.word === selectedWord}
                  onClick={() => onWordClick(node.word)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    // Space scrolls the page otherwise.
                    event.preventDefault()
                    onWordClick(node.word)
                  }}
                  // App.tsx's <header> is sticky and opaque; without this the
                  // browser's focus scroll-into-view has no way to know the
                  // sticky overlay exists and can land a tabbed-to word right
                  // underneath it. --header-height is the same custom
                  // property the header offset in src/index.css uses, so the
                  // two cannot drift apart.
                  // focus-visible rather than focus: a <text> with tabIndex takes
                  // focus on click too, and the browser's default ring drew a
                  // hard black rectangle around whichever word had just been
                  // clicked. Keyboard focus still gets a ring — that is the
                  // whole distinction — and it is drawn in the ink rather than
                  // in the UA's colour.
                  className="cursor-pointer scroll-mt-[var(--header-height)] outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                >
                  {node.word}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function categoryColor(signals: KeywordGraphData['nodes'][number] | undefined): string {
  return sectionColor(signals?.category_slug)
}

function tooltip(
  word: string,
  count: number,
  signals: KeywordGraphData['nodes'][number] | undefined,
  surge: Surge | undefined,
): string {
  const head = `${word} · ${count}건`
  const movement = surgeText(surge)
  if (!signals) return movement ? `${head}\n${movement}` : head

  const parts = [head]
  if (movement) parts.push(movement)
  parts.push(
    `집중도 ${format(signals.spec)}`,
    `어절 ${format(signals.standalone)}`,
    `건당이웃 ${format(signals.neighbors_per_doc)}`,
    `결합 ${format(signals.assoc)}`,
    `통과 ${signals.passed_by}`,
  )
  return parts.join('\n')
}

// The ratio is of shares of the day, not of raw counts — see src/lib/surge.ts
// for why counts across days are not comparable here.
function surgeText(surge: Surge | undefined): string | null {
  if (!surge) return null
  if (surge.kind === 'new') return '신규 (직전 수집일에 없던 단어)'
  return `직전 수집일 대비 ${surge.ratio!.toFixed(1)}배`
}

function surgeLabel(surge: Surge | undefined): string {
  const text = surgeText(surge)
  return text ? `, ${text}` : ''
}

function clampSize(value: number): number {
  return Math.min(SURGE_MAX_SIZE, Math.max(SURGE_MIN_SIZE, value))
}

function format(value: number | null): string {
  return value === null ? '—' : value.toFixed(2)
}
