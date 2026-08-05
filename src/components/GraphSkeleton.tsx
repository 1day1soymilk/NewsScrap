// Holds the graph's footprint while it loads, so the page does not collapse to
// one line of text and then jump back open. Deliberately not a fake graph:
// scattering placeholder words would suggest a layout that the real one is
// about to contradict.
export function GraphSkeleton() {
  return (
    <div
      data-testid="graph-skeleton"
      role="status"
      aria-busy="true"
      aria-label="불러오는 중"
      // 그래프 상자와 같은 폭이어야 한다. 자리를 잡아 두는 것이 이 컴포넌트의
      // 유일한 일인데, 1024로 두면 넓은 창에서 로딩이 끝나는 순간 캔버스가
      // 570px 넓어지며 페이지가 튄다 — 막으려던 바로 그 일이다.
      className="mx-auto w-full max-w-[1600px]"
    >
      <div className="mx-auto mb-3 h-4 w-56 animate-pulse rounded-full bg-line" />
      <div className="h-[380px] w-full animate-pulse rounded-xl bg-ground" />
    </div>
  )
}
