import { useEffect, useMemo, useRef, useState } from 'react'
import { computeGraphLayout, CLUSTER_ROUNDING } from './graphLayout'
import type { MeasuredWord } from './graphLayout'
import { computeFontSizes } from './wordCloudLayout'
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
const FALLBACK_WIDTH = 700

// scoring_weights.demote_factor is 0.3, but the RPC ships only the boolean
// `faded`, so this is a second copy of that number by necessity. Kept slightly
// higher because 0.3 on a white background is barely legible.
const FADED_OPACITY = 0.38
// Everything outside the focused word's neighbourhood.
const UNFOCUSED_OPACITY = 0.1

// Every colour here is a reference into the @theme block in src/index.css,
// which is the single source of truth. Holding hex values in this file was
// what let the old six-section palette drift into an 80-degree band without
// anything noticing; src/lib/theme.test.ts now enforces the spacing.
const CATEGORY_COLORS: Record<string, string> = {
  politics: 'var(--color-section-politics)',
  economy: 'var(--color-section-economy)',
  society: 'var(--color-section-society)',
  culture: 'var(--color-section-culture)',
  world: 'var(--color-section-world)',
  it: 'var(--color-section-it)',
}
const NEUTRAL_COLOR = 'var(--color-ink)'
// Edges read as structure rather than as text, so they get their own colour.
// They can afford to be this solid because routing stops them short of every
// label — nothing is drawn underneath a word for them to fight with.
const EDGE_COLOR = 'var(--color-edge)'
// Applied to an edge that had to be routed under a label because the field was
// too crowded for any single curve to miss everything.
const CROWDED_EDGE_FADE = 0.5

// Ordinary clusters are achromatic and the top story is not. Two overlapping
// washes double to 0.14, which is why distinguishing them by opacity failed:
// that landed on exactly the strength that was meant to single the top story
// out. Grey cannot stack into blue, so the ambiguity is gone by construction
// and the top story's own opacity can come down.
const CLUSTER_TINT = 'var(--color-cluster)'
const CLUSTER_OPACITY = 0.07
const TOP_STORY_TINT = 'var(--color-top-story)'
const TOP_STORY_OPACITY = 0.1

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
}

export function KeywordGraph({
  graph,
  selectedWord,
  onWordClick,
  colorByCategory,
  surges,
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

  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(width * HEIGHT_RATIO)))

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
    if (!selectedWord) return base
    if (word === selectedWord || neighbors.has(word)) return base
    return UNFOCUSED_OPACITY
  }

  const topStory = layout.clusters[0]

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
      {/* Named in text rather than drawn on the canvas. A caption floating over
          the graph would have to dodge the labels, and the words it names are
          already the ones inside the strongest blob. */}
      {topStory && (
        <p className="mb-3 text-center text-sm text-ink-muted">
          <span className="mr-2 rounded-full bg-top-story/10 px-2 py-0.5 text-top-story">
            오늘의 톱 스토리
          </span>
          {topStory.words.join(' · ')}
          <span className="ml-2 text-ink-faint">{topStory.headlines}건</span>
        </p>
      )}

      {/* The mark is small and sits off the side of a word; without a key it
          reads as a rendering artefact rather than as a claim about the day. */}
      {marked && (
        <p className="mb-3 text-center text-xs text-ink-muted">
          <span className="mr-1" style={{ color: SURGE_COLOR }}>
            {SURGE_MARK}
          </span>
          직전 수집일 대비 급상승
        </p>
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
        className="mx-auto block max-w-full select-none"
      >
        {/* An edge running between two sections fades from one section's ink to
            the other's, so a stroke says which words it joins without being
            traced end to end. That is what makes crossings readable enough to
            allow. Only in the all-categories view: inside one section every
            word is the same colour, so a gradient there would encode nothing. */}
        {colorByCategory && (
          <defs>
            {layout.edges.map((edge, index) => {
              const curve = edge.curve
              if (!curve) return null
              return (
                <linearGradient
                  key={`${edge.a}--${edge.b}`}
                  id={gradientId(index)}
                  gradientUnits="userSpaceOnUse"
                  x1={curve.x1}
                  y1={curve.y1}
                  x2={curve.x2}
                  y2={curve.y2}
                >
                  <stop offset="0%" stopColor={categoryColor(signalsByWord.get(edge.a))} />
                  <stop offset="100%" stopColor={categoryColor(signalsByWord.get(edge.b))} />
                </linearGradient>
              )
            })}
          </defs>
        )}
        <g>
          {layout.clusters.map((cluster, index) => (
            // Filled and stroked in the same colour: the stroke is what rounds
            // the hull's corners into a blob instead of a polygon.
            <polygon
              key={cluster.words[0]}
              points={cluster.hull.map((p) => `${p.x},${p.y}`).join(' ')}
              style={{
                fill: index === 0 ? TOP_STORY_TINT : CLUSTER_TINT,
                stroke: index === 0 ? TOP_STORY_TINT : CLUSTER_TINT,
              }}
              strokeWidth={CLUSTER_ROUNDING}
              strokeLinejoin="round"
              opacity={index === 0 ? TOP_STORY_OPACITY : CLUSTER_OPACITY}
            />
          ))}
        </g>
        <g>
          {layout.edges.map((edge, index) => {
            // One relationship, one stroke. This used to be several <line>s per
            // edge, the leftovers of cutting each label box out of a straight
            // line, and several collinear dashes read as several relationships.
            const curve = edge.curve
            if (!curve) return null
            const touchesSelection =
              !selectedWord || edge.a === selectedWord || edge.b === selectedWord
            return (
              <path
                key={`${edge.a}--${edge.b}`}
                d={`M${curve.x1} ${curve.y1}Q${curve.cx} ${curve.cy} ${curve.x2} ${curve.y2}`}
                fill="none"
                style={{ stroke: colorByCategory ? `url(#${gradientId(index)})` : EDGE_COLOR }}
                strokeLinecap="round"
                strokeWidth={1.4 + 2.6 * edge.npmi}
                // Stronger association draws a heavier, darker line; that is the
                // only job NPMI has here, having failed as a word-quality signal.
                //
                // A stroke the routing could not keep off the labels is drawn
                // fainter, so it stops competing with the words it runs under.
                // That is the price of never dropping a relationship.
                strokeOpacity={
                  (touchesSelection ? 0.45 + 0.4 * edge.npmi : 0.12) *
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
                  className="cursor-pointer scroll-mt-[var(--header-height)] hover:underline"
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

// Scoped by the edge's index rather than by its words: an id has to be unique
// in the document and a Korean word is not a safe fragment identifier.
function gradientId(index: number): string {
  return `edge-ink-${index}`
}

function categoryColor(signals: KeywordGraphData['nodes'][number] | undefined): string {
  if (!signals) return NEUTRAL_COLOR
  return CATEGORY_COLORS[signals.category_slug] ?? NEUTRAL_COLOR
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
