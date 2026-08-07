import { share } from './share'
import type { WordCount } from './types'

// Day-over-day movement, ranked by how much of the day a word gained.
//
// Two decisions here were made against measurements on 2026-08-01 vs
// 2026-07-31 rather than by reasoning, and both matter.
//
// **Shares, not counts.** 2026-08-01 was collected twice — a manual run plus
// the 13:00 KST cron, with the 150-per-category cap applying per run — so it
// holds 1,144 headlines against 2026-07-31's 899. Compared on raw counts every
// word looks about 27% up. Dividing each day by its own headline total makes a
// uniform inflation cancel; the median drawn word then sits at a ratio of 0.98,
// which is what says the normalisation is doing its job.
//
// **A rank, not a threshold.** A ratio cut of 1.5 marked 58 of the 110 words
// drawn that day, and a mark on half the screen points at nothing — the same
// failure, for the same reason, as shading all 26 communities instead of the
// top few. Ranking on the *gain in share* rather than on the ratio is what
// keeps a big word that grew ahead of a small word that appeared: 까마귀 (a
// fluff story, 10 headlines, new) outranks 호르무즈 (18 headlines, 5.9x) on
// ratio and loses to it on gained share.
//
// Kleinberg's burst model is the proper instrument for this and is what the
// plan reserves for it, but it measures intensity against a historical
// baseline and the archive is two days long. Gained share is the honest
// version of the question at this archive size.

export type SurgeKind = 'new' | 'surging'

export interface Surge {
  kind: SurgeKind
  /** Today's share divided by the previous day's. Null for a word that is new. */
  ratio: number | null
  /** Today's share minus the previous day's. What the ranking is on. */
  gain: number
}

/** One day's side of the comparison. */
export interface DaySnapshot {
  /**
   * Counts for the words being compared. Must not be a list that some cap
   * could have truncated — see fetchWordCountsFor, which names its words for
   * exactly this reason.
   */
  counts: WordCount[]
  /**
   * Headlines collected that day. Passed in rather than summed from `counts`
   * on purpose: summing a response that PostgREST may have cut at 1,000 rows
   * is how this went wrong the first time, and a denominator the caller has to
   * supply cannot be got that way by accident.
   */
  headlines: number
}

export interface SurgeOptions {
  /** How many words are marked at most. */
  limit?: number
  /** Below this many headlines the movement is noise, not news. */
  minCount?: number
}

const DEFAULT_LIMIT = 8
const DEFAULT_MIN_COUNT = 3

// Roughly a fourteenth of what is on screen, never more than eight and never
// none. A flat cap does not travel: eight marks is a modest annotation on the
// all-categories view's 110 words and covers most of a category tab that drew
// twenty. The point of the mark is to be a minority wherever it appears.
export function surgeLimitFor(drawnWords: number): number {
  return Math.max(1, Math.min(DEFAULT_LIMIT, Math.round(drawnWords / 14)))
}

export function computeSurges(
  today: DaySnapshot,
  previous: DaySnapshot,
  options: SurgeOptions = {},
): Map<string, Surge> {
  const { limit = DEFAULT_LIMIT, minCount = DEFAULT_MIN_COUNT } = options

  // No previous day to compare against — on the first collected day every word
  // is new, which is true and useless.
  if (today.headlines <= 0 || previous.headlines <= 0) return new Map()

  const previousByWord = new Map(previous.counts.map((row) => [row.word, row.count]))

  const moved: (Surge & { word: string })[] = []
  for (const row of today.counts) {
    if (row.count < minCount) continue

    const before = previousByWord.get(row.word) ?? 0
    const todayShare = share(row.count, today.headlines)
    const previousShare = share(before, previous.headlines)
    const gain = todayShare - previousShare
    if (gain <= 0) continue

    moved.push({
      word: row.word,
      kind: before === 0 ? 'new' : 'surging',
      ratio: before === 0 ? null : todayShare / previousShare,
      gain,
    })
  }

  // Ties break on the word, as they do server side, so the same day always
  // marks the same words.
  moved.sort((a, b) => b.gain - a.gain || a.word.localeCompare(b.word))

  return new Map(
    moved.slice(0, limit).map(({ word, ...surge }) => [word, surge]),
  )
}
