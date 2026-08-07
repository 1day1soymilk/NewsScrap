import { useEffect, useMemo } from 'react'
import type { Category, HeadlineSummary } from '../lib/types'
import { sectionColor } from '../lib/sectionColors'
import { WordHistory } from './WordHistory'
import type { HistoryPoint } from '../lib/history'

interface HeadlinePanelProps {
  /** 무엇에 대한 목록인가. null이면 패널이 닫힌다. */
  subject: string | null
  /** 사건의 이름은 단어 목록이므로 따옴표를 두르지 않는다. */
  isEvent?: boolean
  headlines: HeadlineSummary[]
  /** In tab order, which is what the list groups by. */
  categories: Category[]
  loading: boolean
  error: string | null
  onClose: () => void
  /**
   * The subject word's share across the collected days. Empty for an event —
   * event identity is not defined across days here, so there is no line to
   * draw.
   */
  history?: HistoryPoint[]
}

export function HeadlinePanel({
  subject,
  isEvent = false,
  headlines,
  categories,
  loading,
  error,
  onClose,
  history = [],
}: HeadlinePanelProps) {
  const open = subject !== null
  const heading = isEvent ? `${subject} 관련 헤드라인` : `"${subject}" 관련 헤드라인`

  // Registered only while the panel is open, so Escape stays free for anything
  // else on the page the rest of the time.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const labels = useMemo(
    () => new Map(categories.map((category) => [category.slug, category.label])),
    [categories],
  )

  const sorted = useMemo(
    () => sortHeadlines(dedupe(headlines), categories),
    [headlines, categories],
  )

  if (!open) return null

  return (
    // Bottom sheet on a phone, side drawer from `sm` up. The fixed 320px drawer
    // it replaces covered most of the graph on a narrow screen, so clicking a
    // word hid the thing that had just been clicked.
    //
    // Starting below the toolbar rather than at sm:top-0: the toolbar is sticky,
    // and a panel starting at the top of the viewport covered the date and the
    // tabs, so choosing a word took away the controls for choosing a different
    // one. The offset is --header-height from src/index.css rather than a literal,
    // because the toolbar wraps to two rows below lg and any single hard-coded
    // value is wrong on one side of that breakpoint.
    <aside
      className="fixed inset-x-0 bottom-0 z-20 max-h-[70svh] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-4 shadow-lg sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-(--header-height) sm:max-h-none sm:w-80 sm:rounded-none sm:border-l sm:border-t-0"
      aria-label={heading}
    >
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">
          {heading}
          {!loading && !error && sorted.length > 0 && (
            <span className="ml-2 font-sans text-sm font-normal text-ink-faint">
              {sorted.length}건
            </span>
          )}
        </h2>
        <button onClick={onClose} className="shrink-0 text-ink-faint hover:text-ink">
          닫기
        </button>
      </div>

      {!isEvent && <WordHistory points={history} />}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {!error && loading && <HeadlineSkeleton />}

      {!error && !loading && sorted.length === 0 && (
        <p className="text-sm text-ink-muted">관련 헤드라인이 없습니다.</p>
      )}

      {!error && !loading && sorted.length > 0 && (
        <ul>
          {sorted.map((headline) => (
            <li key={headline.id} className="border-b border-line py-3 first:pt-0 last:border-0">
              {/* The section reads as the same dot the tab row and the canvas
                  use, rather than as a pill of its own. On a word that ran in
                  one section the old chips were a column of identical badges
                  down the panel, each one louder than the headline beside it. */}
              <p className="mb-1 flex items-center gap-1.5 text-xs text-ink-faint">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: sectionColor(headline.category_slug) }}
                />
                {labels.get(headline.category_slug) ?? headline.category_slug}
              </p>
              {/* Ink, not --color-top-story. A headline is not the day's biggest
                  event, and painting every link in that blue meant the one
                  colour on the page that names something specific also meant
                  "this is a link". Outside the anchor stays outside it: the
                  accessible name has to be the headline and nothing else. */}
              <a
                href={headline.link}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink-faint"
              >
                {headline.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

// Holds the shape of the list rather than collapsing to a line of text, so the
// panel does not jump when the rows arrive.
function HeadlineSkeleton() {
  return (
    <div data-testid="headline-skeleton" aria-busy="true" aria-label="불러오는 중" className="space-y-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="space-y-2">
          <div className="h-4 w-12 animate-pulse rounded-full bg-line" />
          <div className="h-3.5 w-full animate-pulse rounded bg-line" />
          <div className="h-3.5 w-3/5 animate-pulse rounded bg-line" />
        </div>
      ))}
    </div>
  )
}

// Naver serves one article under two paths — /mnews/article/421/0009091462 and
// /article/421/0009091462 — but that no longer produces two rows: canonicalLink
// (lib/headlines.ts) folds both into one before insert, and migration 0007
// cleaned up the archive rows that had already leaked through. What this
// function still collapses is a genuinely different case — one article listed
// under two sections, which is two legitimate rows with two different links,
// and the panel should still show it once.
//
// The identity is the press id and the article id at the end of the path, so
// that is the key. Keyed on the link rather than on the title because two
// genuinely different articles can carry the same headline.
//
// dedupe() runs before sortHeadlines() below, on rows PostgREST returns in
// arbitrary order, so for that one cross-section article which of its two
// section badges survives is not deterministic.
function articleKey(headline: HeadlineSummary): string {
  const path = (headline.link ?? '').split('?')[0]
  const match = path.match(/(\d+)\/(\d+)\/?$/)
  return match ? `${match[1]}/${match[2]}` : headline.link || headline.id
}

function dedupe(headlines: HeadlineSummary[]): HeadlineSummary[] {
  const seen = new Set<string>()
  return headlines.filter((headline) => {
    const key = articleKey(headline)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// PostgREST hands these back in whatever order the join produced, which
// reshuffles between loads of the same word. Section first so the badges come
// in runs, then title so the order is fixed.
function sortHeadlines(headlines: HeadlineSummary[], categories: Category[]): HeadlineSummary[] {
  const rank = new Map(categories.map((category, index) => [category.slug, index]))
  // A slug with no matching category sorts last instead of colliding with the
  // first one at index 0.
  const rankOf = (slug: string) => rank.get(slug) ?? categories.length

  return [...headlines].sort(
    (a, b) =>
      rankOf(a.category_slug) - rankOf(b.category_slug) ||
      a.title.localeCompare(b.title, 'ko'),
  )
}
