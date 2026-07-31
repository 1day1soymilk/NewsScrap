# 네이버 뉴스 워드클라우드 스크랩 앱 — 설계

## Context

현재 `NewsScrap` 저장소는 Vite + React + TypeScript + Tailwind 스캐폴드에 Supabase 클라이언트 연동 준비(`.env.example`에 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`)만 되어 있고, `src/App.tsx`는 제목만 표시하는 빈 화면 상태다.

사용자는 네이버 뉴스 헤드라인을 카테고리별로 매일 자동 수집해, 헤드라인 제목에서 추출한 명사를 멘티미터 스타일 워드클라우드로 보여주는 개인용 뉴스 스크랩 웹앱을 원한다. 단어를 클릭하면 그 단어가 포함된 헤드라인 목록(원문 링크 포함)을 볼 수 있어야 하고, 과거 날짜도 날짜 선택으로 다시 조회할 수 있어야 한다. 로그인은 불필요한 개인 프로젝트이며, 자동 수집은 별도 서버 없이 Supabase만으로 동작해야 한다.

## Architecture

백엔드는 Supabase 하나로 완결한다 (Postgres + Edge Function + pg_cron). 프론트엔드는 기존 Vite React 앱을 확장해 로컬 실행(추후 배포는 선택 사항)한다.

```
pg_cron (매일 지정 시각, KST)
   └─ Supabase Edge Function `collect-headlines` 호출
        ├─ 카테고리별 네이버 뉴스 RSS 파싱 → 헤드라인(제목/링크/일시) 수집
        ├─ 헤드라인마다 ETRI 형태소분석 API 호출 → 명사(NNG/NNP)만 추출
        └─ Postgres에 저장 (headlines, headline_nouns), 카테고리 하나 실패해도 나머지는 계속 진행

프론트엔드 (기존 src/App.tsx 확장)
   └─ 날짜 선택(기본 오늘) + 카테고리 탭 → Supabase에서 read-only 조회
        └─ 워드클라우드 렌더링 (빈도 비례 크기, 클릭 시 해당 단어 포함 헤드라인 목록 패널)
```

RLS는 read-only 공개 접근으로 충분 (로그인 불필요).

## Data Model (Supabase Postgres)

- **`categories`**: `id`, `slug`(politics/economy/society/it/world/culture 등), `label`(한글명), `rss_url`. 시딩 데이터 — 구현 단계에서 실제 네이버 뉴스 RSS 엔드포인트 URL을 확인해 채운다.
- **`headlines`**: `id`, `category_id` FK → categories, `title`, `link`, `published_at`, `collected_date`(KST 기준 조회용 날짜). `(category_id, link)` unique 제약으로 같은 날 중복 수집 방지.
- **`headline_nouns`**: `headline_id` FK → headlines, `word`. 헤드라인당 여러 행. 워드클라우드 빈도 집계와 "이 단어 포함 헤드라인 목록" 조회를 이 테이블 하나의 GROUP BY / JOIN으로 처리 (개인 프로젝트 트래픽 규모엔 사전 집계 테이블 불필요).

## Edge Function `collect-headlines`

1. pg_cron이 매일 지정 시각(예: 07:00 KST)에 함수 호출.
2. 카테고리별로 RSS fetch → XML 파싱 (Deno 호환 경량 XML 파서).
3. 헤드라인 제목마다 ETRI 형태소분석 Open API(POST, API 키는 Supabase 함수 시크릿으로 관리)를 호출해 NNG/NNP 태그 단어만 추출. 2글자 미만 단어 및 소규모 불용어(예: "기자", "사진", "종합") 필터링.
4. `headlines` + `headline_nouns` upsert (링크 중복 시 스킵).
5. 카테고리 하나가 RSS/ETRI 호출에 실패해도 나머지 카테고리는 계속 진행, 실패는 함수 로그에 남긴다.

## Frontend

- 상단: 날짜 선택(기본값 오늘, 데이터 있는 날짜만 선택 가능) + 카테고리 탭(정치/경제/사회/IT 등 + "전체")
- 중앙: 워드클라우드 — `d3-cloud` 레이아웃 + SVG 렌더링, 빈도수에 비례한 글자 크기
- 단어 클릭 → 사이드 패널/모달에 해당 단어가 포함된 헤드라인 목록(원문 링크 포함) 표시
- 기존 `src/App.tsx`의 제목("오늘의 주요 뉴스 스크랩")은 최상단 헤더로 유지, 그 아래에 위 UI를 구성

## Error Handling

- 선택한 날짜에 데이터가 없으면(첫 수집 이전 등) "아직 수집된 데이터가 없습니다" 안내 표시
- Supabase 조회 실패 시 재시도 버튼과 함께 에러 메시지 표시
- Edge Function은 카테고리/헤드라인 단위 부분 실패를 허용 (한 곳이 죽어도 전체 수집이 죽지 않음)

## Testing

- Edge Function: RSS 파싱 / ETRI 응답 파싱 / 명사 필터링을 순수 함수로 분리해 Deno test로 단위 테스트 (샘플 XML/JSON 픽스처 사용)
- 프론트엔드: 워드클라우드 크기 계산, 클릭 시 헤드라인 필터링 로직을 Vitest로 단위 테스트
- 엔드투엔드 검증: Edge Function을 로컬(Supabase CLI)로 한 번 수동 실행해 실제 데이터가 테이블에 쌓이는지 확인 후, `npm run dev`로 프론트엔드에서 해당 날짜 워드클라우드가 렌더링되는지 확인

## Open Items for Implementation Phase

- 카테고리별 실제 네이버 뉴스 RSS 엔드포인트 URL 확인
- ETRI Open API 무료 키 발급 (사용자가 aiopen.etri.re.kr에서 직접 발급 필요) 및 Supabase 함수 시크릿 등록
- Supabase 프로젝트가 아직 없다면 프로젝트 생성 및 `.env`에 URL/anon key 채우기, pg_cron 확장 활성화
