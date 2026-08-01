import { useEffect, useMemo, useRef, useState } from 'react'
import { computeGraphLayout, CLUSTER_ROUNDING } from './graphLayout'
import type { MeasuredWord } from './graphLayout'
import { computeFontSizes } from './wordCloudLayout'
import type { KeywordGraphData } from '../lib/types'

// Must match the font the <text> elements below actually render in, or every
// measured width is wrong and labels overlap.
const FONT_FAMILY = 'sans-serif'

const MIN_HEIGHT = 380
const MAX_HEIGHT = 640
const FALLBACK_WIDTH = 700

// scoring_weights.demote_factor is 0.3, but the RPC ships only the boolean
// `faded`, so this is a second copy of that number by necessity. Kept slightly
// higher because 0.3 on a white background is barely legible.
const FADED_OPACITY = 0.38
// Everything outside the focused word's neighbourhood.
const UNFOCUSED_OPACITY = 0.1

// Provisional. Phase 4 settles the real palette along with the background; the
// point of having them now is to see whether colouring by section reads at all.
const CATEGORY_COLORS: Record<string, string> = {
  politics: '#b45309',
  economy: '#047857',
  society: '#1d4ed8',
  culture: '#a21caf',
  world: '#0e7490',
  it: '#4338ca',
}
const NEUTRAL_COLOR = '#1f2937'
// Edges read as structure rather than as text, so they get their own colour.
// They can afford to be this solid because routing stops them short of every
// label — nothing is drawn underneath a word for them to fight with.
const EDGE_COLOR = '#64748b'
// Event clusters. Provisional along with everything else here; Phase 4 settles
// the palette.
//
// The top story gets its own hue rather than more of the same one. Adjacent
// stories overlap — 트럼프·이스라엘·하마스 sits against 공습·에너지시설·미사일 —
// and two stacked tints at 0.07 land on exactly the 0.14 that was meant to mark
// the top story, so strength alone cannot say which blob is which.
const CLUSTER_TINT = '#6366f1'
const CLUSTER_OPACITY = 0.07
const TOP_STORY_TINT = '#f59e0b'
const TOP_STORY_OPACITY = 0.18

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
}

export function KeywordGraph({
  graph,
  selectedWord,
  onWordClick,
  colorByCategory,
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

  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(width * 0.62)))

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
    return <p className="text-center text-gray-500">아직 수집된 데이터가 없습니다.</p>
  }

  function nodeOpacity(word: string, faded: boolean): number {
    const base = faded ? FADED_OPACITY : 1
    if (!selectedWord) return base
    if (word === selectedWord || neighbors.has(word)) return base
    return UNFOCUSED_OPACITY
  }

  const topStory = layout.clusters[0]

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-5xl">
      {/* Named in text rather than drawn on the canvas. A caption floating over
          the graph would have to dodge the labels, and the words it names are
          already the ones inside the strongest blob. */}
      {topStory && (
        <p className="mb-3 text-center text-sm text-gray-500">
          <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
            오늘의 톱 스토리
          </span>
          {topStory.words.join(' · ')}
          <span className="ml-2 text-gray-400">{topStory.headlines}건</span>
        </p>
      )}

      {/* Cropped to the labels rather than to the canvas the simulation ran in,
          and rendered at that box's own size so nothing is magnified. A day
          with eight words in one category gets a small frame instead of a clump
          adrift in a large one. */}
      <svg
        width={layout.bounds.width}
        height={layout.bounds.height}
        viewBox={`${layout.bounds.x} ${layout.bounds.y} ${layout.bounds.width} ${layout.bounds.height}`}
        role="group"
        aria-label="키워드 관계망"
        className="mx-auto block max-w-full select-none"
      >
        <g>
          {layout.clusters.map((cluster, index) => (
            // Filled and stroked in the same colour: the stroke is what rounds
            // the hull's corners into a blob instead of a polygon.
            <polygon
              key={cluster.words[0]}
              points={cluster.hull.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={index === 0 ? TOP_STORY_TINT : CLUSTER_TINT}
              stroke={index === 0 ? TOP_STORY_TINT : CLUSTER_TINT}
              strokeWidth={CLUSTER_ROUNDING}
              strokeLinejoin="round"
              opacity={index === 0 ? TOP_STORY_OPACITY : CLUSTER_OPACITY}
            />
          ))}
        </g>
        <g>
          {layout.edges.map((edge) => {
            const touchesSelection =
              !selectedWord || edge.a === selectedWord || edge.b === selectedWord
            return edge.segments.map((segment, index) => (
              // One edge can survive as several pieces when it passes behind a
              // word on its way, so the key carries the piece's index.
              <line
                key={`${edge.a}--${edge.b}--${index}`}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                stroke={EDGE_COLOR}
                strokeLinecap="round"
                strokeWidth={1.4 + 2.6 * edge.npmi}
                // Stronger association draws a heavier, darker line; that is the
                // only job NPMI has here, having failed as a word-quality signal.
                strokeOpacity={touchesSelection ? 0.45 + 0.4 * edge.npmi : 0.12}
              />
            ))
          })}
        </g>
        <g>
          {layout.nodes.map((node) => {
            const signals = signalsByWord.get(node.word)
            const color =
              colorByCategory && signals
                ? (CATEGORY_COLORS[signals.category_slug] ?? NEUTRAL_COLOR)
                : NEUTRAL_COLOR

            return (
              // <title> sits on the wrapper, not inside <text>: as a child of
              // <text> it becomes part of that element's text content, and every
              // selector matching a word exactly would stop matching. Browsers
              // walk up to the nearest <title>, so the tooltip is unaffected.
              <g key={node.word}>
                <title>{tooltip(node.word, node.count, signals)}</title>
                <text
                  x={node.x}
                  y={node.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={node.fontSize}
                  fontFamily={FONT_FAMILY}
                  fill={color}
                  opacity={nodeOpacity(node.word, node.faded)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.word}, ${node.count}건`}
                  aria-pressed={node.word === selectedWord}
                  onClick={() => onWordClick(node.word)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    // Space scrolls the page otherwise.
                    event.preventDefault()
                    onWordClick(node.word)
                  }}
                  className="cursor-pointer hover:underline"
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

function tooltip(
  word: string,
  count: number,
  signals: KeywordGraphData['nodes'][number] | undefined,
): string {
  if (!signals) return `${word} · ${count}건`
  const parts = [
    `${word} · ${count}건`,
    `집중도 ${format(signals.spec)}`,
    `어절 ${format(signals.standalone)}`,
    `건당이웃 ${format(signals.neighbors_per_doc)}`,
    `결합 ${format(signals.assoc)}`,
    `통과 ${signals.passed_by}`,
  ]
  return parts.join('\n')
}

function format(value: number | null): string {
  return value === null ? '—' : value.toFixed(2)
}
