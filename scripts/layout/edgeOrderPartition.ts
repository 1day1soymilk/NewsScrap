// scripts/layout/edgeOrderPartition.ts
//
// Migration 0024 gave the edge ordering a `, a, b` tie-break, on the argument
// that the old `order by npmi desc, cooc desc` was not a total order and that a
// permutation of tied edges could therefore move the drawn picture. 18 of the
// archive's 35 day-by-view cells came back with a different edge order.
//
// **The argument was never tested, so this tests it.** For each cell it runs the
// frontend's own partition code over the old edge array and over the new one and
// compares the two answers:
//
//   * `computeGraphLayout(...).communities` — the raw Louvain partition, which is
//     the same call the canvas makes and the same object it hands up through
//     `onCommunities`.
//   * `mergeCommunities(...)` from src/lib/events.ts — what the event list is
//     actually built from, since two communities joined by MERGE_MIN_EDGES are
//     one event.
//
// Partitions are compared **up to relabelling**: a community's numeric id is an
// artefact of iteration order and means nothing on its own, so what is compared
// is the grouping — the set of blocks, each block a sorted set of words.
//
//   node --experimental-strip-types --import ./scripts/layout/register.mjs \
//        scripts/layout/edgeOrderPartition.ts <fixture.json>
//
// **What it found, for 0024:** of the 18 cells whose edge order moved, **0**
// moved the Louvain partition and **0** moved the merged events — the tie in
// `detectCommunities` goes to the lowest community id, so neighbour order cannot
// decide a move. **7 moved the drawn geometry**, via d3 `forceLink` walking the
// link array in order and accumulating velocities in a different sequence. Six
// of those are sub-pixel; 2026-08-02's all-view rearranged one event internally,
// 전남 by 137.6px.
//
// The fixture is `{day, view, nodes, old_edges, new_edges}[]` and is **not
// checked in** — it is two orderings of the same edge set, so it only exists
// while there is an old ordering to compare against. To rebuild it, restore the
// previous function body under another name and select both:
//
//   select d::text as day, coalesce(v.cat,'(all)') as view,
//          public.keyword_graph(d, v.cat)->'nodes' as nodes,
//          public.kg_old_0018(d, v.cat)->'edges'   as old_edges,
//          public.keyword_graph(d, v.cat)->'edges' as new_edges
//   from (values (…days…)) t(d), (values (null::text),('politics'),…) v(cat);
//
// This script is not part of any suite. It is kept because it is the way to
// re-ask the question if the edge ordering is ever changed again, and because
// the answer above is the evidence for a tie-break that would otherwise look
// like superstition.

import { readFileSync } from 'node:fs'
import { computeGraphLayout } from '../../src/components/graphLayout.ts'
import type { MeasuredWord } from '../../src/components/graphLayout.ts'
import { computeFontSizes } from '../../src/components/wordCloudLayout.ts'
import { mergeCommunities } from '../../src/lib/events.ts'
import type { GraphEdge } from '../../src/lib/types.ts'

interface FixtureNode {
  word: string
  count: number
  faded: boolean
  category_slug: string | null
}
interface Cell {
  day: string
  view: string
  nodes: FixtureNode[]
  old_edges: GraphEdge[]
  new_edges: GraphEdge[]
}

const fixturePath = process.argv[2]
if (!fixturePath) throw new Error('usage: edgeOrderPartition.ts <fixture.json>')
const cells: Cell[] = JSON.parse(readFileSync(fixturePath, 'utf8'))

// measure.ts's jsdom stand-in for canvas text measurement. The absolute widths
// differ from the browser's, but both sides of every comparison here use the
// same one, and the partition does not depend on width at all — it is computed
// from the edge topology before anything is positioned.
function measuredWords(nodes: FixtureNode[]): MeasuredWord[] {
  const sized = computeFontSizes(nodes.map((n) => ({ word: n.word, count: n.count })))
  const fadedByWord = new Map(nodes.map((n) => [n.word, n.faded]))
  return sized.map((s) => ({
    word: s.text,
    count: s.count,
    fontSize: s.fontSize,
    textWidth: s.text.length * s.fontSize * 0.95,
    faded: fadedByWord.get(s.text) ?? false,
  }))
}

/** A partition as a canonical string: blocks of sorted words, blocks sorted. */
function canonical(partition: Map<string, number>): string {
  const blocks = new Map<number, string[]>()
  for (const [word, id] of partition) {
    if (!blocks.has(id)) blocks.set(id, [])
    blocks.get(id)!.push(word)
  }
  return JSON.stringify(
    [...blocks.values()].map((b) => b.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  )
}

function analyse(cell: Cell, edges: GraphEdge[]) {
  const words = measuredWords(cell.nodes)
  const layout = computeGraphLayout(words, edges, { width: 1024 })
  const eventWords = cell.nodes.map((n) => ({ word: n.word, count: n.count }))
  const merged = mergeCommunities(eventWords, edges, layout.communities)
  return {
    louvain: canonical(layout.communities),
    events: canonical(merged),
    // The partition is only half the question. The layout metrics in
    // scripts/layout/README.md (xIn, xBr, crowded, overlap) are computed from
    // drawn geometry, and d3's forceLink applies its velocity updates walking
    // the link array in order — so positions can move even when the grouping
    // does not. Coordinates are compared to 0.001px; the bounds and the region
    // boxes come along because those are what `crop` and the packing produce.
    geometry: JSON.stringify({
      nodes: [...layout.nodes]
        .sort((a, b) => (a.word < b.word ? -1 : 1))
        .map((n) => [n.word, n.x.toFixed(3), n.y.toFixed(3)]),
      bounds: layout.bounds,
      regions: layout.regions.map((r) => [
        [...r.words].sort().join(','),
        r.x.toFixed(3), r.y.toFixed(3), r.width.toFixed(3), r.height.toFixed(3),
      ]),
    }),
    at: new Map(layout.nodes.map((n) => [n.word, [n.x, n.y] as [number, number]])),
  }
}

/** Largest single-word displacement between two layouts, in px. */
function maxShift(
  a: Map<string, [number, number]>,
  b: Map<string, [number, number]>,
): number {
  let worst = 0
  for (const [word, [ax, ay]] of a) {
    const to = b.get(word)
    if (!to) continue
    worst = Math.max(worst, Math.hypot(to[0] - ax, to[1] - ay))
  }
  return worst
}

let moved = 0
let louvainDiff = 0
let eventsDiff = 0
let geometryDiff = 0
const rows: string[] = []

for (const cell of cells) {
  const orderMoved = JSON.stringify(cell.old_edges) !== JSON.stringify(cell.new_edges)
  if (!orderMoved) continue
  moved++

  const before = analyse(cell, cell.old_edges)
  const after = analyse(cell, cell.new_edges)
  const lSame = before.louvain === after.louvain
  const eSame = before.events === after.events
  const gSame = before.geometry === after.geometry
  if (!lSame) louvainDiff++
  if (!eSame) eventsDiff++
  if (!gSame) geometryDiff++

  rows.push(
    `${cell.day}  ${cell.view.padEnd(8)}  edges ${String(cell.new_edges.length).padStart(3)}` +
      `  louvain ${lSame ? 'same ' : 'MOVED'}` +
      `  events ${eSame ? 'same ' : 'MOVED'}` +
      `  geometry ${gSame ? 'same' : 'MOVED'}` +
      `  maxShift ${maxShift(before.at, after.at).toFixed(4)}px`,
  )
}

console.log(rows.join('\n'))
console.log(
  `\n${moved} cells with a moved edge order; ${louvainDiff} moved the Louvain ` +
    `partition, ${eventsDiff} moved the merged events, ${geometryDiff} moved the drawn geometry.`,
)
