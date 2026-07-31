import type { WordCount } from '../lib/types'

export interface SizedWord {
  text: string
  count: number
  fontSize: number
}

export const MIN_FONT_SIZE = 14
export const MAX_FONT_SIZE = 64

export function computeFontSizes(words: WordCount[]): SizedWord[] {
  if (words.length === 0) return []

  const counts = words.map((w) => w.count)
  const min = Math.min(...counts)
  const max = Math.max(...counts)

  return words.map(({ word, count }) => {
    const ratio = max === min ? 1 : (count - min) / (max - min)
    const fontSize = Math.round(MIN_FONT_SIZE + ratio * (MAX_FONT_SIZE - MIN_FONT_SIZE))
    return { text: word, count, fontSize }
  })
}
