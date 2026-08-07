import { useEffect, useId, useState } from 'react'
import { formatDate } from '../lib/formatDate'
import { searchWords } from '../lib/queries'
import type { WordMatch } from '../lib/queries'

interface WordSearchProps {
  onSelect: (word: string) => void
}

// 타자를 치는 동안 매 글자마다 묻지 않는다. 250ms는 한 글자를 더 칠 만한 시간이고,
// 사전 조회 자체가 서버에서 ~35ms(웜), ~60ms(콜드)이므로 왕복까지 더하면 이 값은
// 요청 수만이 아니라 네트워크 비용을 줄이기 위한 것이기도 하다.
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
 *
 * **콤보박스 + 리스트박스 팝업**, WAI-ARIA 저작 관행을 그대로 따른다. 입력에
 * `role="combobox"`를 얹고 옵션은 `<li role="option">` 자신이 맡는다 — 이전에는
 * 그 안에 `<button role="option">`을 하나 더 넣었는데, 그것은 유효한 리스트박스
 * 구조가 아니었고 키보드로는 입력에 닿은 뒤 결과로 넘어갈 방법이 없었다.
 */
export function WordSearch({ onSelect }: WordSearchProps) {
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<WordMatch[]>([])
  const [searched, setSearched] = useState(false)
  // 활성 옵션의 인덱스. null은 "아직 아무것도 짚지 않았다" — 화살표를 눌러야
  // 짚힌다. 리스트박스 패턴 중 "수동 선택"에 해당한다: 입력값을 활성 옵션으로
  // 자동으로 덮어쓰지 않는다.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  // Escape로 닫혔는지. term은 그대로 두고 목록만 접는 상태라 searched/matches와는
  // 독립적으로 둔다 — 지우면 다음에 같은 term으로도 다시 열 방법이 없어진다.
  const [closed, setClosed] = useState(false)

  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = (index: number) => `${baseId}-option-${index}`

  useEffect(() => {
    setClosed(false)
    setActiveIndex(null)

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

  const listboxOpen = matches.length > 0 && !closed

  function selectMatch(match: WordMatch) {
    // 고르고 나면 목록도 입력창도 비운다. 비우지 않으면 목록이 선택 뒤에도
    // 열린 채로 남고, 이 컴포넌트에는 Escape나 바깥 클릭으로 닫는 처리가
    // 없어 HeadlinePanel의 전역 Escape 핸들러가 패널을 대신 닫아 버린다.
    setTerm('')
    setMatches([])
    setSearched(false)
    setActiveIndex(null)
    setClosed(false)
    onSelect(match.word)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (listboxOpen) {
        // 브라우저 기본 동작(webkit 계열은 검색 입력에서 Escape에 값을 지운다)이
        // term을 건드리지 못하게 막는다 — 요구사항은 목록만 닫는 것이다.
        event.preventDefault()
        setClosed(true)
        setActiveIndex(null)
      }
      return
    }

    if (!listboxOpen) return

    switch (event.key) {
      case 'ArrowDown':
        // 감싸 돈다: 결과 수가 SEARCH_LIMIT으로 이미 작게 잡혀 있어 끝에서
        // 막히는 것보다 처음으로 순환하는 편이 키보드로 훑기 편하다.
        event.preventDefault()
        setActiveIndex((prev) => (prev === null ? 0 : (prev + 1) % matches.length))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((prev) => (prev === null ? matches.length - 1 : (prev - 1 + matches.length) % matches.length))
        break
      case 'Enter':
        if (activeIndex !== null) {
          event.preventDefault()
          selectMatch(matches[activeIndex])
        }
        break
      default:
        break
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={listboxOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          listboxOpen && activeIndex !== null ? optionId(activeIndex) : undefined
        }
        aria-autocomplete="list"
        autoComplete="off"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={handleKeyDown}
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

      {listboxOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="검색 결과"
          className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
        >
          {matches.map((match, index) => (
            <li
              key={match.word}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectMatch(match)}
              className={`flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-ground ${
                index === activeIndex ? 'bg-ground' : ''
              }`}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
