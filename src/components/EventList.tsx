import { eventLabel } from '../lib/events'
import { UNFOCUSED_OPACITY } from '../lib/focus'
import type { RankedEvent } from '../lib/events'

// 1위 앞의 점. 지금 "오늘의 톱 스토리" 캡션이 쓰는 바로 그 색이고, 목록에서
// 유일한 색이다.
//
// 사건은 여러 섹션에 걸치므로 섹션 잉크는 쓸 수 없다 — 탭 줄이 캔버스의 색
// 열쇠이고, 화면의 초록과 다른 초록을 부르는 두 번째 열쇠는 없느니만 못하다.
const TOP_STORY_TINT = 'var(--color-top-story)'

interface EventListProps {
  events: RankedEvent[]
  /** 선택된 사건의 첫 단어, 없으면 null. */
  selected: string | null
  /**
   * 캔버스에서 누른 단어가 속한 사건들의 첫 단어. 그 행만 남고 나머지는 캔버스와
   * 같은 값으로 물러난다. **비어 있으면 아무 행도 물러나지 않는다** — 엣지가
   * 하나도 없는 단어(하루 70개 중 20개)를 누르면 밝힐 사건이 없고, 그때 목록
   * 전체가 흐려지면 고장으로 읽힌다.
   */
  related?: ReadonlySet<string>
  onSelect: (topWord: string) => void
}

export function EventList({ events, selected, related, onSelect }: EventListProps) {
  // 엣지가 하나도 없는 날은 사건이 0개다. 오류가 아니라 그날 아무것도 이어지지
  // 않았다는 뜻이고, 지금 캡션이 없을 때와 같이 아무것도 그리지 않는다.
  if (events.length === 0) return null

  const dimming = related !== undefined && related.size > 0

  return (
    <ol aria-label="오늘의 사건" className="flex min-w-0 flex-col gap-0.5 text-sm">
      {events.map((ranked, rank) => {
        const top = ranked.event.words[0].word
        const { shown, rest } = eventLabel(ranked.event.words)
        const isSelected = top === selected
        // 강조는 파생값이지 선택이 아니므로 aria-pressed를 건드리지 않는다.
        // 단어 선택과 사건 선택은 배타적이라 둘이 한 화면에 공존하지도 않는다.
        const isRelated = related?.has(top) ?? false

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
              {/* 자리는 모든 줄이 잡고 색만 1위가 갖는다. 점 없는 줄이
                  들여쓰기를 잃으면 목록이 계단처럼 어긋난다. */}
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
    </ol>
  )
}
