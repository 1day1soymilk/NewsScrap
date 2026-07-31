import { useEffect, useState } from 'react'
import cloud from 'd3-cloud'
import { computeFontSizes, MIN_FONT_SIZE } from './wordCloudLayout'
import type { WordCount } from '../lib/types'

// cloud().start() is synchronous, so an unbounded word list blocks the main
// thread for seconds; d3-cloud silently drops whatever does not fit anyway.
// Words arrive sorted by count descending, so this keeps the most frequent ones.
export const MAX_CLOUD_WORDS = 100

interface PlacedWord {
  text: string
  fontSize: number
  x: number
  y: number
  rotate: number
}

interface WordCloudProps {
  words: WordCount[]
  onWordClick: (word: string) => void
  width?: number
  height?: number
}

export function WordCloud({ words, onWordClick, width = 700, height = 450 }: WordCloudProps) {
  const [placed, setPlaced] = useState<PlacedWord[]>([])

  useEffect(() => {
    let cancelled = false
    const sized = computeFontSizes(words.slice(0, MAX_CLOUD_WORDS))
    if (sized.length === 0) {
      setPlaced([])
      return
    }

    const layout = cloud()
      .size([width, height])
      .words(sized.map((w) => ({ text: w.text, size: w.fontSize })))
      .padding(4)
      .rotate(0)
      .font('sans-serif')
      .fontSize((d) => (d as { size: number }).size)
      .on('end', (output) => {
        if (cancelled) return
        setPlaced(
          output.map((word) => ({
            text: word.text ?? '',
            fontSize: (word as unknown as { size: number }).size ?? MIN_FONT_SIZE,
            x: word.x ?? 0,
            y: word.y ?? 0,
            rotate: word.rotate ?? 0,
          })),
        )
      })

    layout.start()

    return () => {
      cancelled = true
    }
  }, [words, width, height])

  if (placed.length === 0) {
    return <p className="text-center text-gray-500">아직 수집된 데이터가 없습니다.</p>
  }

  return (
    <svg width={width} height={height} className="mx-auto">
      <g transform={`translate(${width / 2}, ${height / 2})`}>
        {placed.map((word) => (
          <text
            key={word.text}
            textAnchor="middle"
            fontSize={word.fontSize}
            transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
            onClick={() => onWordClick(word.text)}
            className="cursor-pointer fill-current hover:opacity-70"
          >
            {word.text}
          </text>
        ))}
      </g>
    </svg>
  )
}
