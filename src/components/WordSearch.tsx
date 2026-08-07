import { useEffect, useState } from 'react'
import { formatDate } from '../lib/formatDate'
import { searchWords } from '../lib/queries'
import type { WordMatch } from '../lib/queries'

interface WordSearchProps {
  onSelect: (word: string) => void
}

// 타자를 치는 동안 매 글자마다 묻지 않는다. 250ms는 한 글자를 더 칠 만한 시간이고,
// 사전 조회 자체는 ~1ms이므로 이 값은 네트워크가 아니라 요청 수를 위한 것이다.
const DEBOUNCE_MS = 250

/**
 * 캔버스가 그리지 않은 단어로 가는 길.
 *
 * 화면에 손이 닿는 단어는 그려진 70개뿐이고, 아카이브에는 19,767개가 있다. 체에
 * 걸린 단어는 존재를 확인할 방법조차 없었다.
 *
 * **찾은 단어를 골라도 날짜는 바뀌지 않는다.** 보던 날을 말없이 빼앗지 않기
 * 위해서다 — 어느 날로 가야 하는지는 패널의 궤적이 말해 주고, 이동은 읽는 사람이
 * 한다.
 */
export function WordSearch({ onSelect }: WordSearchProps) {
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<WordMatch[]>([])
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (term.trim() === '') {
      setMatches([])
      setSearched(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchWords(term)
        .then((found) => {
          // 느린 앞 요청이 새 응답을 덮어쓰지 못하게 한다. 지우고 다시 치면
          // 두 요청이 겹치고, 도착 순서는 보낸 순서가 아니다.
          if (cancelled) return
          setMatches(found)
          setSearched(true)
        })
        .catch(() => {
          // 급상승 표식과 같은 방식으로 삼킨다. 검색이 실패해도 화면은 그대로
          // 읽히고, 오류 페이지를 띄우는 것보다 목록이 비는 편이 낫다.
          if (cancelled) return
          setMatches([])
          setSearched(true)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term])

  return (
    <div className="relative">
      <input
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        // 보이는 라벨이 없으므로 접근 가능한 이름은 여기서 나온다.
        aria-label="단어 검색"
        placeholder="단어 검색"
        className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint sm:w-56"
      />

      {searched && matches.length === 0 && (
        <p className="absolute z-40 mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
          찾은 단어가 없습니다.
        </p>
      )}

      {matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="검색 결과"
          className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
        >
          {matches.map((match) => (
            <li key={match.word}>
              <button
                role="option"
                aria-selected={false}
                onClick={() => onSelect(match.word)}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-ground"
              >
                <span className="truncate text-ink">{match.word}</span>
                <span className="ml-auto shrink-0 tabular-nums text-xs text-ink-muted">
                  {match.total.toLocaleString('ko-KR')}건 · {match.days}일
                </span>
                {/* 마지막으로 나온 날. 정렬은 건수 순이므로, 일주일 전에 컸던
                    단어와 오늘 큰 단어를 구별하는 것은 이 글자다. */}
                <span className="shrink-0 text-xs text-ink-faint">
                  {formatDate(match.lastDate).day}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
