// src/lib/queryCache.ts
//
// 같은 날짜·카테고리를 다시 보는 것은 이 화면의 기본 동작이다 — 탭을 A→B→A로
// 돌리거나 날짜를 하루 앞뒤로 왕복하는 것. 캐시가 없으면 그때마다 같은
// keyword_graph RPC와 급상승 요청 3개와 event_headline_counts가 그대로 다시
// 나간다.
//
// **아끼는 것이 네트워크만이 아니다.** App.tsx의 메모는 전부 신원 비교이므로,
// 같은 객체를 돌려주는 것만으로 그 아래가 통째로 건너뛰어진다: 캔버스의
// measureText 70회, 루뱅 분할, 300틱 시뮬레이션, 엣지마다 도는 곡선 탐색까지.
// 그래서 여기 담기는 것은 **결과가 아니라 promise**이고, 두 번째 호출은 첫
// 번째가 만든 바로 그 객체를 받는다(진행 중인 요청의 중복 제거도 같은 코드로
// 공짜다).

// 지난 날짜의 데이터는 불변이지만 오늘 것은 07:00 KST cron으로 바뀌고, 탭을
// 열어 둔 채 그 경계를 넘을 수 있다.
export const CACHE_TTL_MS = 5 * 60 * 1000

// 하루의 화면은 카테고리 7가지(전체 포함)이므로 며칠을 오가도 이 안에 든다.
// 상한은 오래 연 세션이 무한정 자라지 않게 하는 것이지 적중률을 위한 값이 아니다.
export const CACHE_MAX_ENTRIES = 24

interface Entry {
  /** 응답을 요청한 시각. 다시 읽혀도 갱신하지 않는다 — 아니면 계속 읽히는 키가 영원히 신선한 척한다. */
  at: number
  value: Promise<unknown>
}

const entries = new Map<string, Entry>()

export function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  const held = entries.get(key)
  if (held && Date.now() - held.at < CACHE_TTL_MS) return held.value as Promise<T>

  const value = run()
  // Map은 삽입 순서를 지키므로 그 순서가 곧 나이순이다. 이미 있던 키는 지웠다가
  // 다시 넣어야 갱신된 자리로 간다.
  entries.delete(key)
  entries.set(key, { at: Date.now(), value })

  // 실패는 남기지 않는다. 화면의 "다시 시도" 버튼이 5분 동안 같은 오류를
  // 되돌려주면 그것은 다시 시도가 아니다.
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key)
  })

  while (entries.size > CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next()
    if (oldest.done) break
    entries.delete(oldest.value)
  }
  return value
}

export function clearQueryCache(): void {
  entries.clear()
}
