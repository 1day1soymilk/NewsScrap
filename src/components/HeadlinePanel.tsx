import { useEffect, useMemo } from 'react'
import type { Category, HeadlineSummary } from '../lib/types'

interface HeadlinePanelProps {
  word: string | null
  headlines: HeadlineSummary[]
  /** In tab order, which is what the list groups by. */
  categories: Category[]
  loading: boolean
  error: string | null
  onClose: () => void
}

export function HeadlinePanel({
  word,
  headlines,
  categories,
  loading,
  error,
  onClose,
}: HeadlinePanelProps) {
  const open = word !== null

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

  const sorted = useMemo(() => sortHeadlines(headlines, categories), [headlines, categories])

  if (!open) return null

  return (
    // Bottom sheet on a phone, side drawer from `sm` up. The fixed 320px drawer
    // it replaces covered most of the graph on a narrow screen, so clicking a
    // word hid the thing that had just been clicked.
    <aside
      className="fixed inset-x-0 bottom-0 z-20 max-h-[70svh] overflow-y-auto rounded-t-xl border-t bg-white p-4 shadow-lg sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-[var(--header-height)] sm:max-h-none sm:w-80 sm:rounded-none sm:border-l sm:border-t-0"
      aria-label={`"${word}" 관련 헤드라인`}
    >
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          &quot;{word}&quot; 관련 헤드라인
          {!loading && !error && sorted.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">{sorted.length}건</span>
          )}
        </h2>
        <button onClick={onClose} className="shrink-0 text-gray-500 hover:text-gray-900">
          닫기
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!error && loading && <HeadlineSkeleton />}

      {!error && !loading && sorted.length === 0 && (
        <p className="text-sm text-gray-500">관련 헤드라인이 없습니다.</p>
      )}

      {!error && !loading && sorted.length > 0 && (
        <ul className="space-y-3">
          {sorted.map((headline) => (
            <li key={headline.id} className="flex flex-col gap-1">
              <span className="w-fit rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {labels.get(headline.category_slug) ?? headline.category_slug}
              </span>
              <a
                href={headline.link}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-700 hover:underline"
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
          <div className="h-4 w-12 animate-pulse rounded-full bg-gray-200" />
          <div className="h-3.5 w-full animate-pulse rounded bg-gray-200" />
          <div className="h-3.5 w-3/5 animate-pulse rounded bg-gray-200" />
        </div>
      ))}
    </div>
  )
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
