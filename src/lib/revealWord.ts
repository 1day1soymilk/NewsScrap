// 누른 단어가 헤드라인 패널에 가리지 않도록 페이지를 얼마나 내릴 것인가.
//
// **왜 순수 함수인가.** 이 값을 CSS 상수로 둘 수 없다. 앞서 있는 sticky 헤더 회피는
// `scroll-mt-[var(--header-height)]` 한 줄이고 그것으로 충분한데, 그쪽은 헤더 높이가
// 정말 상수이기 때문이다. 하단 시트는 `max-h-[70svh]`라 **내용에 따라 높이가 다르고**
// (실측: 844px 화면에서 297px, 곧 35svh), 70svh를 상수로 박으면 짧은 시트에서 두 배로
// 넘겨 스크롤한다. 그래서 실제 상자를 받아 계산한다.
//
// 그리고 클릭에는 브라우저의 초점 스크롤이 안 걸린다 — 포인터로 준 초점은 스크롤을
// 일으키지 않는다(실측: 단어가 시트 뒤로 들어가는 동안 `scrollY`가 0이었다). 그래서
// CSS만으로는 애초에 아무 일도 일어나지 않는다.

/** 단어와 시트 사이에 남겨 둘 여백. 붙어 있으면 잘린 것처럼 읽힌다. */
export const REVEAL_GAP = 12

type Edges = { top: number; bottom: number }
type Box = { top: number; left: number; right: number }

/**
 * 페이지를 아래로 얼마나 스크롤할 것인가(px). 0이면 아무것도 안 한다.
 *
 * 좌표는 전부 뷰포트 기준(`getBoundingClientRect`)이다. 아래로 `d`만큼 스크롤하면
 * 내용은 위로 `d`만큼 올라가므로, 단어를 시트 위로 올리는 데 필요한 값이 곧 답이다.
 */
export function revealScrollDelta(
  word: Edges,
  panel: Box,
  viewport: { width: number; height: number },
  headerHeight: number,
): number {
  // **하단 시트일 때만 해당된다.** `sm` 이상에서 패널은 오른쪽 옆서랍이고, 세로로는
  // 겹치지 않으므로 스크롤은 읽던 화면을 발밑에서 움직이는 것 말고 하는 일이 없다.
  // 판정은 폭을 다 쓰는가로 한다 — 그것이 `inset-x-0`인 시트의 정의다.
  if (panel.left > 0 || panel.right < viewport.width) return 0
  // 시트가 화면 밖에 있으면 가릴 것도 없다.
  if (panel.top >= viewport.height) return 0

  const needed = word.bottom + REVEAL_GAP - panel.top
  if (needed <= 0) return 0

  // **가린 것을 다른 것으로 바꾸지 않는다.** 헤더는 sticky이고 불투명하므로, 단어를
  // 그 위로 밀어 올리면 시트 대신 헤더가 덮는다. 올릴 수 있는 만큼만 올리고, 모자라면
  // 모자란 채로 둔다 — 최선을 다한 자리가 아무것도 안 한 자리보다 낫다.
  const room = word.top - headerHeight
  if (room <= 0) return 0
  return Math.min(needed, room)
}
