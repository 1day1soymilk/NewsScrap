import { PostgrestClient } from '@supabase/postgrest-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase env vars are not set. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env',
  )
}

// PostgREST 클라이언트를 직접 쓴다 — supabase-js의 createClient가 아니라.
//
// 이 앱에는 로그인이 없고(RLS는 select-only 정책과 anon 키만으로 성립한다)
// realtime도, storage도, edge function 호출도 없다. 그런데 createClient는
// auth-js와 realtime-js를 **즉시 인스턴스화**하므로 번들러가 그것을 떼어내지
// 못하고, 쓰지 않는 두 라이브러리가 통째로 실려 나가고 있었다.
//
// 대신 손으로 다는 것은 supabase-js가 붙여 주던 두 헤더뿐이다: apikey와 Bearer
// 토큰. 둘 다 같은 anon 키이고 서버가 anon 역할로 해석하는 경로도 그대로라,
// 접근 모델은 조금도 달라지지 않는다.
//
// 자리표시자를 비우면 안 된다. 이 모듈은 앱 모듈 그래프의 맨 위에서 평가되므로
// 여기서 던지면 React가 마운트되기도 전에 화면이 백지가 된다 — 문서화된 빈 상태
// UI가 아니라. 자리표시자를 넣으면 구성은 성공하고 실제 요청이 호출 시점에
// 실패해 기존 오류 처리로 흘러간다.
//
// `??`가 아니라 `||`인 것도 의도다: 선언만 되고 비어 있는 .env 값
// (`VITE_SUPABASE_URL=`)을 Vite는 undefined가 아니라 ''로 읽으므로 `??`는 빈
// 문자열을 통과시킨다. "현대화"하지 말 것.
const url = supabaseUrl || 'http://localhost:54321'
const key = supabaseAnonKey || 'placeholder-anon-key'

export const supabase = new PostgrestClient(`${url}/rest/v1`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
  },
})
