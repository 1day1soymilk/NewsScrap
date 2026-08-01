export interface Category {
  id: string
  slug: string
  label: string
}

export interface WordCount {
  word: string
  count: number
}

export interface HeadlineSummary {
  id: string
  title: string
  link: string
}

// Mirrors the json_build_object in keyword_graph (0003_keyword_scoring.sql).
// The four signals ride along unused by the layout: they are what threshold
// tuning reads off the screen, which is why the RPC ships them at all.
export interface GraphNode {
  word: string
  count: number
  spec: number | null
  standalone: number | null
  neighbors_per_doc: number | null
  // Null for a word that shares no headline with any other word.
  assoc: number | null
  // Which sieve-4 clause admitted the word: 'length' | 'spec' | 'neighbors' | 'allow'.
  passed_by: string
  category_slug: string
  // Past node_limit, or listed as 'demote'. Drawn, but dimmed.
  faded: boolean
}

export interface GraphEdge {
  a: string
  b: string
  cooc: number
  npmi: number
}

export interface KeywordGraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
