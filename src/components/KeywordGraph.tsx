import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { computeGraphLayout } from './graphLayout'
import type { MeasuredWord } from './graphLayout'
import { computeFontSizes } from './wordCloudLayout'
import { NEUTRAL_INK, sectionColor } from '../lib/sectionColors'
import type { KeywordGraphData } from '../lib/types'
import type { Surge } from '../lib/surge'

// Must match the font the <text> elements below actually render in, or every
// measured width is wrong and labels overlap.
const FONT_FAMILY = 'sans-serif'

const MIN_HEIGHT = 380
// Width is fixed by the container and the svg is scaled down to fit it, so
// spreading the words sideways buys nothing — the whole picture just shrinks by
// the same factor. Height is the only free axis, and giving the simulation more
// of it is what actually puts air between the labels.
const MAX_HEIGHT = 820
const HEIGHT_RATIO = 0.78

// Below this the canvas is a phone's, and the desktop ratio gives a box far too
// small to lay 70 labels out in: at 358px wide it is 358x279, and the collision
// pass cannot resolve that many boxes in it, so the words simply land on top of
// each other. The area a label needs does not shrink with the viewport — a
// 14px word is 14px on a phone — so the canvas has to grow with the word count
// rather than with the width, and on a phone the page scrolls anyway.
const NARROW_WIDTH = 640
const NARROW_HEIGHT_PER_WORD = 13
const NARROW_MAX_HEIGHT = 1500
const FALLBACK_WIDTH = 700

// scoring_weights.demote_factor is 0.3, but the RPC ships only the boolean
// `faded`, so this is a second copy of that number by necessity. Kept slightly
// higher because 0.3 on a white background is barely legible.
const FADED_OPACITY = 0.38
// Everything outside the focused word's neighbourhood.
const UNFOCUSED_OPACITY = 0.1

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

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      if (measured > 0) setWidth(measured)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const height = useMemo(() => {
    if (width >= NARROW_WIDTH) {
      return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(width * HEIGHT_RATIO)))
    }
    return Math.min(
      NARROW_MAX_HEIGHT,
      Math.max(MIN_HEIGHT, Math.round(width * 0.5 + graph.nodes.length * NARROW_HEIGHT_PER_WORD)),
    )
  }, [width, graph.nodes.length])

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
    () => computeGraphLayout(measured, graph.edges, { width, height }),
    [measured, graph.edges, width, height],
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
            return (
              <path
                key={`${edge.a}--${edge.b}`}
                d={`M${curve.x1} ${curve.y1}Q${curve.cx} ${curve.cy} ${curve.x2} ${curve.y2}`}
                fill="none"
                style={{ stroke: EDGE_COLOR }}
                strokeLinecap="round"
                strokeWidth={0.9 + 1.3 * edge.npmi}
                // Stronger association draws a heavier, darker line; that is the
                // only job NPMI has here, having failed as a word-quality signal.
                //
                // A stroke the routing could not keep off the labels is drawn
                // fainter, so it stops competing with the words it runs under.
                // That is the price of never dropping a relationship.
                strokeOpacity={
                  (touchesSelection ? 0.26 + 0.22 * edge.npmi : 0.1) *
                  (curve.clear ? 1 : CROWDED_EDGE_FADE)
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
