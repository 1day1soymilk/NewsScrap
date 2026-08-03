import { eventLabel } from '../lib/events'
import { UNFOCUSED_OPACITY } from '../lib/focus'
import type { RankedEvent } from '../lib/events'

// The dot in front of the top story: the same colour that caption used, and the
// only colour in the list.
//
// Section ink cannot be used, because an event spans several sections — the tab
// row is the canvas's colour key, and a second key naming a different green
// from the one on screen is worse than no key.
const TOP_STORY_TINT = 'var(--color-top-story)'

interface EventListProps {
  events: RankedEvent[]
  /** The selected event's first word, or null. */
  selected: string | null
  /**
   * Indices of the events the word clicked on the canvas belongs to. Those rows
   * stay lit and the rest recede at the canvas's own value. **An empty list
   * dims nothing** — clicking one of the 20 words a day that hold no edge lights
   * no event, and a wholly grey list reads as a fault.
   *
   * Indices rather than words because `NewsEvent.index` is already the identity
   * the bridge map is keyed by, so nothing has to be translated to match here.
   */
  related?: readonly number[]
  /**
   * How many events the day holds in total. The toggle appears only when this
   * exceeds the rows given, so a category tab — or a day with five events —
   * offers nothing to open.
   */
  total?: number
  expanded?: boolean
  onToggle?: () => void
  onSelect: (topWord: string) => void
}

export function EventList({
  events,
  selected,
  related = [],
  total = events.length,
  expanded = false,
  onToggle,
  onSelect,
}: EventListProps) {
  // A day with no edges has no events. That is not an error, it means nothing
  // was connected that day, and nothing is drawn.
  if (events.length === 0) return null

  const dimming = related.length > 0

  return (
    <ol aria-label="오늘의 사건" className="flex min-w-0 flex-col gap-0.5 text-sm">
      {events.map((ranked, rank) => {
        const top = ranked.event.words[0].word
        const { shown, rest } = eventLabel(ranked.event.words)
        const isSelected = top === selected
        // Highlighting is derived, not selected, so aria-pressed is left alone.
        // A word selection and an event selection are mutually exclusive anyway,
        // so a lit row and a pressed row never coexist on screen.
        const isRelated = related.includes(ranked.event.index)

        return (
          <li key={top}>
            <button
              type="button"
              onClick={() => onSelect(top)}
              aria-pressed={isSelected}
              data-related={isRelated ? 'true' : undefined}
              style={dimming && !isRelated ? { opacity: UNFOCUSED_OPACITY } : undefined}
              className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left transition-opacity hover:bg-surface motion-reduce:transition-none ${
                isSelected || isRelated ? 'bg-surface' : ''
              }`}
            >
              {/* Every row reserves the space and only the first row takes the
                  colour. A row without the dot losing its indent would step the
                  list sideways. */}
              <span
                aria-hidden="true"
                className="inline-block size-2 shrink-0 translate-y-px rounded-full"
                style={{ background: rank === 0 ? TOP_STORY_TINT : 'transparent' }}
              />
              <span className="min-w-0 text-ink">
                {shown.join(' · ')}
                {rest > 0 && <span className="text-ink-faint"> 외 {rest}</span>}
              </span>
              {ranked.headlines !== null && (
                <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-ink-faint">
                  {ranked.headlines}건
                </span>
              )}
            </button>
          </li>
        )
      })}

      {onToggle && (expanded || total > events.length) && (
        // Inside the list, because it is about the list's own length rather than
        // a control that happens to sit under it. The dot column is kept so the
        // label lines up with the event names above it.
        <li>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs text-ink-faint hover:bg-surface hover:text-ink"
          >
            <span aria-hidden="true" className="inline-block size-2 shrink-0" />
            <span>{expanded ? '접기' : `더 보기 ${total - events.length}개`}</span>
          </button>
        </li>
      )}
    </ol>
  )
}
