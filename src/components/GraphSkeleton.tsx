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
      className="mx-auto w-full max-w-5xl"
    >
      <div className="mx-auto mb-3 h-4 w-56 animate-pulse rounded-full bg-line" />
      <div className="h-[380px] w-full animate-pulse rounded-xl bg-ground" />
    </div>
  )
}
