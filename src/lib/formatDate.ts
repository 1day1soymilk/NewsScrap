// src/lib/formatDate.ts
//
// 마스트헤드가 쓰는 유일한 산술. 컴포넌트 파일에서 export하면 fast refresh가
// 깨지고(oxlint react/only-export-components), 잘못된 날짜 경로는 그것 없이
// 검사할 방법이 없다 — dateNav.ts 옆이 제자리다.

// Invalid dates reach this from a hand-edited query string, and Intl renders
// those as "Invalid Date" rather than throwing — which would put that string in
// the masthead at 36px.
export function formatDate(iso: string): { day: string; weekday: string; year: string } {
  const parsed = new Date(`${iso}T00:00:00+09:00`)
  if (Number.isNaN(parsed.getTime())) return { day: iso, weekday: '', year: '' }

  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...options }).format(parsed)

  return {
    day: format({ month: 'long', day: 'numeric' }),
    weekday: format({ weekday: 'short' }),
    year: format({ year: 'numeric' }),
  }
}
