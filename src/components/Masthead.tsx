import { formatDate } from '../lib/formatDate'

// The page is a dated record, so the date is what it is about — not a form
// control tucked between a title and a row of tabs, which is where it used to
// live. Set in 명조 against a canvas that is entirely 고딕: the masthead is the
// one part of the page that gets read rather than scanned.
//
// The stepper walks the collected dates rather than the calendar, because the
// archive has gaps and today is thin until the day's own news has been
// published. The native picker stays for jumping further than one step.
export function Masthead({
  date,
  minDate,
  maxDate,
  previousDate,
  nextDate,
  onDateChange,
  words,
  links,
  today,
}: {
  date: string
  minDate?: string
  maxDate?: string
  previousDate: string | null
  nextDate: string | null
  onDateChange: (date: string) => void
  words: number | null
  links: number | null
  /**
   * Set only when the app chose to open on an earlier day than today, and
   * describing the today it passed over. `headlines` is null when today has not
   * been collected at all yet.
   *
   * **This says out loud that the app made a choice.** `src/lib/openingDate.ts`
   * opens on the newest day that has filled up, because before roughly 09:00
   * KST today's pool of words is smaller than the canvas can draw. Silently
   * showing yesterday under no explanation would read as a stale page.
   *
   * **No jump is offered for a day that has not been collected**, because the
   * date input's own `max` does not reach it either and landing there would
   * show an empty canvas — an offer that leads nowhere is worse than a
   * statement.
   */
  today?: { date: string; headlines: number | null } | null
}) {
  const parts = formatDate(date)
  const step =
    'rounded-md px-1.5 text-2xl leading-none text-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-ink-faint'

  return (
    // Everything sits in one left-aligned column. The picker used to be floated
    // to the right edge, where the headline panel — which starts below the
    // toolbar and runs to the bottom — covered it the moment a word was clicked.
    <div className="mb-6">
      <div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => previousDate && onDateChange(previousDate)}
            disabled={!previousDate}
            aria-label="이전 수집일"
            className={step}
          >
            ‹
          </button>
          <p className="font-display text-3xl leading-none font-semibold tracking-tight sm:text-4xl">
            {parts.day}
            <span className="ml-2 align-baseline text-lg font-medium text-ink-faint sm:text-xl">
              {parts.weekday}
            </span>
          </p>
          <button
            onClick={() => nextDate && onDateChange(nextDate)}
            disabled={!nextDate}
            aria-label="다음 수집일"
            className={step}
          >
            ›
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2 pl-1 text-xs text-ink-faint">
          <span>{parts.year}</span>
          {words !== null && links !== null && (
            <>
              <span>·</span>
              <span>단어 {words}</span>
              <span>·</span>
              <span>관계 {links}</span>
            </>
          )}
          <span>·</span>
          {/* The stepper walks to the neighbouring collected date; this is for
              jumping further than one step, so it is the quieter of the two. */}
          <label className="flex items-center gap-1.5">
            <span className="sr-only">날짜 선택</span>
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-faint hover:text-ink"
            />
          </label>
        </div>
        {today && (
          <p className="mt-2 pl-1 text-xs text-ink-faint">
            {today.headlines === null ? (
              <>오늘({formatDate(today.date).day})은 아직 수집 전입니다</>
            ) : (
              <button
                onClick={() => onDateChange(today.date)}
                className="rounded underline decoration-line underline-offset-2 hover:text-ink"
              >
                오늘({formatDate(today.date).day})은 아직 {today.headlines}건 수집 중 →
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
