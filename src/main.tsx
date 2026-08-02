import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { todayInSeoul } from './lib/dateNav'
import { fetchKeywordGraph } from './lib/queries'
import { parseUrlState } from './lib/urlState'

// 첫 그래프 요청을 React가 마운트되기 **전에** 띄운다.
//
// 이 화면에 그릴 것은 전부 이 한 번의 RPC에서 오는데, 지금까지 그 요청은
// createRoot → 첫 렌더 → effect 를 전부 기다린 뒤에야 나갔다. index.html의
// preconnect가 그 사이에 DNS·TCP·TLS를 끝내 두므로, 여기서 쏘면 이미 선
// 연결 위로 곧장 나간다.
//
// App이 이 응답을 **그대로** 받는 것은 queryCache 덕이다: 같은 인자면 같은
// promise가 돌아가므로 요청이 두 번 나가지 않고, 응답 객체의 신원까지 같아
// 레이아웃도 한 번만 돈다. 캐시가 없다면 이 줄은 요청을 하나 늘릴 뿐이다.
//
// 카테고리를 URL에서 읽을 때 슬러그 목록은 아직 없다 — parseUrlState는 빈
// 목록을 "아직 모름"으로 다루므로 링크에 담긴 슬러그가 그대로 통과하고,
// 유효성은 App이 카테고리를 받은 뒤 다시 본다. 없는 슬러그로 한 번 물어봐야
// 그 응답은 쓰이지 않고 버려질 뿐이고 화면은 달라지지 않는다.
{
  const state = parseUrlState(window.location.search, [])
  // 실패는 삼킨다. 이것은 앞당기기일 뿐이고, 오류를 화면에 내보내는 것은 App의
  // 요청이다 — 캐시는 거절을 담아 두지 않으므로 그쪽이 제대로 다시 시도한다.
  void fetchKeywordGraph(state.date ?? todayInSeoul(), state.category).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
