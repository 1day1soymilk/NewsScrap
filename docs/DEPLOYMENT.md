# 배포 절차

## 사전 준비 (사용자 직접)

1. **Supabase 프로젝트 생성** — [supabase.com](https://supabase.com)
   - **Postgres 15 이상**이어야 한다. 마이그레이션의 `create view ... with (security_invoker = on)` 은
     PG14 이하에서 문법 에러로 `db push` 가 실패한다. 지금 생성되는 신규 프로젝트는 PG15+ 이므로
     기본값 그대로 두면 된다.
   - Project Settings → API 에서 **Project URL**, **anon key**, **service_role key** 를 복사해 둔다.
   - Project Settings → General 의 **Reference ID** 도 복사해 둔다 (`<project-ref>`).

2. **형태소 분석기 — 발급받을 것이 없다.** 함수 안에서 `npm:garu-ko` 를 직접
   돌린다 (MIT, WASM, 1.4MB 모델). 외부 계정도, API 키도, 호출 한도도 없다.
   예전에는 ETRI 의 WiseNLU 를 헤드라인마다 호출했고 `.env.functions` 에
   `ETRI_API_KEY` 를 넣어야 했다 — 지금은 그 파일 자체가 비어 있다.

3. **`.env` 작성** — 저장소 루트에 `.env.example` 을 복사해서 채운다.

   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

   `.env` 는 `.gitignore` 에 있으므로 커밋되지 않는다. service_role key 는 프론트엔드에서
   절대 쓰지 않는다 — Edge Function 시크릿으로만 등록한다.

## 배포

```bash
npx supabase login
npx supabase link --project-ref <project-ref>

# 스키마 적용
npx supabase db push

# Edge Function 시크릿은 등록할 것이 없다. SUPABASE_URL 과
# SUPABASE_SERVICE_ROLE_KEY 는 런타임이 자동 주입하고, 분석기는 키를 쓰지 않는다.
npx supabase functions deploy collect-headlines
```

## 검증

### 1. 함수 수동 호출

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/collect-headlines \
  -H "Authorization: Bearer <anon key>"
```

응답 JSON 의 `summary` 에 6개 카테고리가 모두
`ok: ... collected, ... off-day, ... processed, ... new` 형태로 나와야 한다.
어느 하나라도 `failed:` 면 그 메시지가 원인이다.

`off-day` 는 발행일이 그 실행의 `collected_date` 와 달라서 버린 기사 수다. 03시·07시
실행에서는 크고 낮 실행에서는 0 에 가까운 것이 정상이다. **여섯 섹션이 하루 종일
전부 0 이면** 경계 정지가 동작하지 않는 것이거나 (`published` 가 계속 `null` 로
나오는 것 — 네이버가 썸네일 경로를 바꾸면 그렇게 된다) 그날 아직 경계에 닿은 실행이
없는 것이다. 아래 "날짜 도장" 절을 볼 것.

**실행 시간:** 카테고리당 150건, 총 900건을 4~5초에 처리한다. 전부 신규인
하루 첫 실행도 같은 자릿수다 (측정: 755건 분석에 5.0초).

**막는 한도는 wall-clock 이 아니라 워커의 누적 CPU 시간이고, 대략 3초다.** 이것이
ETRI 를 걷어낼 때 실제로 부딪힌 벽이다 — 45초 실행이 죽고 64.6초 실행이 살아남았다.
분석 자체는 헤드라인당 0.88ms, 900건에 0.8초로 싸다. 예산을 태운 것은 그 주변의
헤드라인당 세 번씩, 총 ~2,700번의 DB 왕복이었다. ETRI 시절에는 그 왕복 하나하나가
500ms 대기 뒤에 있어서 워커가 실행 시간의 98%를 놀았고, 그래서 누적 CPU 가 작았다.
대기를 없앤 것이 CPU 를 늘린 게 아니라 **놀던 시간을 없앴다.**

그래서 저장은 카테고리 단위로 묶는다 (`processHeadlines`): 조회 3회 + upsert 1회 +
명사 insert 몇 회로 카테고리당 5~6 요청이다. 이 형태에서는 3초 예산에 여유가 크다.

함수는 예산을 초과하면 죽는 대신 스스로 멈춘다. `RUN_BUDGET_MS`(50초)를 카테고리 6개로
나눠 각자 몫을 주므로, 느린 실행에서도 특정 카테고리만 계속 굶는 일은 없다. 처리하지 못한
헤드라인은 다음 실행이 이어받는다. 다만 이 예산은 wall-clock 이라 CPU 한도를 막아주지
못한다 — 막아주는 것은 위의 배치다.

`summary` 에 `skipped: run budget exhausted` 가 보이거나 `processed` 가 `collected` 보다
한참 적으면 이렇게 조절한다:
- 섹션당 수집량은 **배포 없이** 바꾼다. `scoring_weights.collect_cap` 에 들어 있고
  함수가 매 실행 시작에 한 번 읽는다. 응답의 `cap` 필드가 그 실행이 실제로 쓴 값이다.

  ```bash
  scripts/analysis/run.sh -c "update public.scoring_weights set value = 300 where key = 'collect_cap'"
  ```

  행이 없거나 값이 이상하면 함수는 150 으로 되돌아간다 (`lib/collectCap.ts`) — 읽기가
  실패했다고 아무것도 수집하지 않는 일은 없다.
- `RUN_BUDGET_MS` 는 `index.ts` 안의 상수다. 유료 플랜이면 `360_000` 으로 올린다.

`WORKER_RESOURCE_LIMIT` 로 죽으면 응답이 없으므로 `summary` 를 읽을 수 없다. 그때는
로그의 `CHK` 줄이 어느 카테고리에서 멈췄는지 말해준다 — **다만 대시보드에서만 보인다.**
Management API 의 로그 엔드포인트는 `function_logs` 에 403 을 주고, MCP `get_logs` 는
요청 단위 행(`execution_time_ms`, status)만 돌려준다. 그래서 카테고리별 단계 시간을
응답 본문에도 넣어 둔다: `(scrape Xms, process Yms)`.

### 1-2. 배포 없이 켜고 끄는 값 (`scoring_weights`)

`collect_cap` 말고도 **측정은 끝났고 판단만 남은** 값이 둘 있다. 둘 다 한 줄로
켜고 되돌릴 수 있고, 재배포가 필요 없다.

- **`place_needs_edge` — 장소 게이트. 마이그레이션 `0028`부터 켜져 있고, 그것이
  지금 실려 있는 상태다.** 지명(`word_overrides`의 `place` 항목, 현재 45개)은
  **지명이 아닌 단어와 이어진 선**이 하나라도 있을 때만 그려진다 — 지명끼리만
  이어진 쌍은 남지 않는다. 빠진 자리는 71위 단어가 채운다.

  **하니스는 이 게이트에 반대했고 `0026`이 그래서 꺼서 출하했다.** `0028`이
  뒤집은 근거는 새 측정이 아니라 화면이다: 껐을 때 2026-08-03의 4위 사건이
  「서울 · 광주」 66건인데, 두 지명이 서로하고만 이어져 있어 그 66건이 무슨
  이야기인지 페이지 어디에도 없다. 되돌리려면 아래 두 번째 줄이면 되고, 그때
  잃는 것과 얻는 것은 `0028` 헤더에 전부 적혀 있다.

  ```bash
  # 되돌리기 (게이트 끄기)
  scripts/analysis/run.sh -c "update public.scoring_weights set value = 0 where key = 'place_needs_edge'"
  # 다시 켜기
  scripts/analysis/run.sh -c "update public.scoring_weights set value = 1 where key = 'place_needs_edge'"
  ```

  측정은 `scripts/analysis/README.md`의 "Round fourteen — three mechanisms
  measured, none shipped" 중 "The place gate: the premise failed, not the
  threshold" 절에 있고, 구현이 왜 `plpgsql` 루프인지는 마이그레이션 `0024`의
  헤더에 있다. **켜고 끄는 것 말고 다시 재는 것이 필요하면 반드시 그 두 곳을 먼저
  읽을 것** — 라벨은 데이터가 움직이면 상해서, 새로 수집한 날 위에서 하네스를
  돌리려면 `20_unlabeled.sql`이 먼저다.

- **`category_balance_alpha` — 수집량 불균형 보정.** 0이 항등(지금 값, 순수
  빈도순)이고 1이 "모든 섹션을 똑같이 수집했다면 나왔을 개수"다. 크기는 안 변하고
  순서만 움직이며, **카테고리 탭 안에서는 α가 무엇이든 항등**이다(같은 섹션의 모든
  행이 같은 상수를 받으므로).

  ```bash
  scripts/analysis/run.sh -c "update public.scoring_weights set value = 1 where key = 'category_balance_alpha'"
  scripts/analysis/run.sh -c "update public.scoring_weights set value = 0 where key = 'category_balance_alpha'"
  ```

  측정은 같은 README의 "α: not measurable on this day set" 절, 정의와 비용은
  마이그레이션 `0025`의 헤더에 있다. 요약하면 **이 네 날 위에서는 α를 잴 수 없다** —
  넷 중 셋이 라벨 기준으로 중립이고 나머지 하나는 균등 수집된 날이라 보정할 것이
  없다. 2026-08-04처럼 섹션이 크게 갈린 날에 라벨이 붙은 뒤에 다시 볼 값이다.

### 2. 데이터 확인 (SQL Editor)

```sql
select category_slug, count(*) from daily_word_counts
where collected_date = current_date group by category_slug;
```

`category_slug` 가 `null` 인 행이 전체 롤업이고, 나머지 6개가 카테고리별 집계다.

### 3. 인덱스 사용 확인

집계 뷰가 `grouping sets` 를 쓰기 때문에 `collected_date` 조건이 뷰 안쪽으로 내려가지 않을
가능성이 있다. 데이터가 며칠 쌓인 뒤 한 번 확인한다:

```sql
explain analyze
select * from daily_word_counts where collected_date = current_date;
```

`headlines_collected_date_idx` 대신 `Seq Scan on headlines` 가 보이고 실행 시간이 눈에 띄게
길어지면, `daily_word_counts` 를 `grouping sets` 없이 카테고리별 뷰 / 전체 롤업 뷰 두 개로
쪼갠다.

### 4. 프론트엔드

```bash
npm run dev
```

날짜/카테고리 전환, 단어 클릭 시 관련 헤드라인 표시까지 확인한다.

## 자동 수집 스케줄

pg_cron 과 pg_net 확장이 **먼저 활성화되어 있어야** 한다.
Dashboard → Database → Extensions 에서 `pg_cron`, `pg_net` 을 켠 뒤 SQL Editor 에서:

```sql
select cron.schedule(
  'collect-headlines-daily',
  '0 22 * * *', -- UTC 22:00 = KST 07:00 다음 날
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/collect-headlines',
    headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
  );
  $$
);
```

등록 확인:

```sql
select jobid, schedule, jobname, active from cron.job;
```

시간대를 바꿀 때는 지우고 다시 등록하지 말고 기존 잡을 고친다 — `cron.schedule` 을
다시 부르면 같은 이름의 잡이 갱신되지만, jobid 로 직접 고치는 편이 명령문(평문 키가
들어 있는)을 다시 붙여넣지 않아도 되어 안전하다.

```sql
select cron.alter_job(job_id := 1, schedule := '0 22 * * *');
```

### 하루 여섯 번 돈다

잡은 하나가 아니라 **여섯 개**이고, 전부 같은 함수를 부른다. 4시간 간격으로
하루를 고르게 덮는다:

| jobname | UTC | KST |
| --- | --- | --- |
| `collect-headlines-03kst` | `0 18 * * *` | 03:00 |
| `collect-headlines-daily` | `0 22 * * *` | 07:00 |
| `collect-headlines-11kst` | `0 2 * * *`  | 11:00 |
| `collect-headlines-15kst` | `0 6 * * *`  | 15:00 |
| `collect-headlines-19kst` | `0 10 * * *` | 19:00 |
| `collect-headlines-23kst` | `0 14 * * *` | 23:00 |

**한 번에 더 많이 긁는 쪽이 CPU 때문에 막히는 것은 아니다.** 예전에 여기 적혀
있던 "300건으로 올렸더니 63초에 546 으로 죽었다" 는 두 번 오진된 기록이다.
2026-08-04 에 쓰고 버린 프로브로 다시 재 봤다 — 이 함수와 똑같이 긁고 똑같이
분석하되 아무것도 쓰지 않는다:

| cap | 헤드라인 | 분석 시간 | wall | 결과 |
| --- | --- | --- | --- | --- |
| 150 | 900 | 816ms | 2.0s | 200 |
| 300 | 1,800 | 1,481ms | 4.2s | 200 |
| 441 | 2,630 | 2,082ms | 5.3s | 200 |

**546 은 요청 하나의 크기가 아니라 워커에 누적된 CPU 때문에 난다.** 같은 cap 441
호출이 새 워커에서는 200 이고 덥혀진 워커의 세 번째 호출에서는 546 이다. 같은
논리라면 4시간 간격의 크론은 워커를 공유하지 않아야 하지만, **이것은 추론이지
실측이 아니다** — 워커가 얼마나 오래 사는지는 이번에 측정한 적이 없고, 확인된
것은 손으로 연달아 부르면 이것을 밟는다는 사실뿐이다. 그때 응답은 **본문이
없다.**

막던 것은 예산이 아니라 **날짜 도장**이었고, 그건 이제 함수가 막는다.
`collected_date` 는 수집한 날이고 깊은 페이지는 오래된 기사라, 하루치 뉴스보다
넓은 창은 어제 뉴스를 오늘로 저장한다. `fetchSectionHeadlines` 가 **다른 날에
발행된 기사를 아예 돌려주지 않는다** — 기사별 발행일(썸네일 경로)로 거르고,
페이지의 가장 오래된 기사가 자정을 넘어가면 페이징을 멈춘다.

**이건 cap 을 올릴 때 생길 비용이 아니라 150 에서 이미 나던 피해였다.** 2026-08-05
12:30 KST 에 그날 저장된 1,224 행 전부를 실시간 섹션 목록과 대조했다: **129 행이
그날 이전 발행**, 88 행은 1,620건 스크랩으로도 못 닿는 더 깊은 곳(따라서 거의
확실히 더 오래된 것). **129 중 80 이 03:00 실행**이다.

**03시·07시 상황은 기다리지 않고도 잴 수 있다.** 목록이 발행 시각 순이므로
"자정부터 T 까지 발행된 기사 수" 가 곧 T 에 시작한 실행이 어제로 넘어가는 순위다.
2026-08-05 12:30 KST 기준:

| 섹션 | 03시까지 | 07시까지 | 11시까지 |
| --- | --- | --- | --- |
| 정치 | 17 | 50 | 140 |
| 경제 | 24 | 120 | 589 |
| 사회 | 42 | 136 | 533 |
| 생활/문화 | 15 | 52 | 131 |
| 세계 | 15 | 75 | 167 |
| IT | 1 | 23 | 81 |

**07시 전에 150 에 닿는 섹션이 하나도 없다.** 03시에 150건 창은 정치에서 150 중
133 칸을, IT 에서 149 칸을 어제에 쓴다. 피해가 129 행에서 그친 건
`UNIQUE (category_id, link)` 이 날짜별이 아니라 전역이라 어제 이미 수집한 기사는
다시 찍히지 않기 때문이다 — 새로 찍힌 129 는 어제 수집이 놓친 구멍뿐이다.

**하루의 반대쪽 끝은 같은 숫자에 대해 정반대를 말하고, 그게 이번 발견이다.**
2026-08-05 에 11시 실행 이전 발행분 중 **42.9% 가 아예 수집되지 않았다** — 1,641
중 704, 경제 61%, 사회 53%. 그 구멍은 전부 07-11시 사이에 있고 **자정-05시에는
하나도 없다.** 즉 150 은 한산한 시간대에는 지나치게 넓고 바쁜 시간대에는 필요량의
절반도 안 된다. **경계 정지가 한 숫자에게 두 일을 시키지 않게 해준다**: 한산할 때는
경계가 먼저 멈추고, 바쁠 때는 경계가 아예 걸리지 않아 cap 이 자유롭게 올라간다.

경계 정지를 켜고 그날 11시 실행이 새로 저장했을 행 수:

| cap | 150 | 200 | 300 | 450 | 600 |
| --- | --- | --- | --- | --- | --- |
| 새 행 | 126 | 228 | 426 | 680 | 704 |

**cap 은 2026-08-07 에 300 으로 올렸다. 300 은 일부러 저 열의 꼭대기가 아니다** —
450 이면 전부 새 기사인 실행이 2,700건이 되는데, 지금까지 측정된 가장 깊은 곳이
2,630 이고 워커 예산은 누적이다. **경계 정지 배포가 먼저**였다: 150 에서도 이미
넘치는데 300 이면 두 배로 넘친다.

### 배포 당일 실측 (2026-08-07)

같은 날 안에서의 전후 비교다. 그날 저장된 모든 행을 경계 너머까지 긁은 섹션
목록에 같은 방법으로 대조했다:

| | 행 | 오늘 발행 | **다른 날 발행** | |
| --- | --- | --- | --- | --- |
| 그날 크론 4회 (구 코드) | 1,821 | 1,545 | **141** | **8.4%** |
| 배포 후 실행 2회 | 937 | 881 | **0** | **0.0%** |

cap 인상 효과도 6분 만에 드러났다. cap 150 실행이 economy 150 · society 148 을
막 저장한 직후에 cap 300 으로 한 번 더 돌렸는데, 151~300위에서 **economy 125건 ·
society 157건이 새로** 나왔다. 07-11시 구멍이 눈앞에서 메워진 것이다.

cap 300 실행은 6.5초에 200. `culture` 는 236건, `it` 는 182건에서 멈췄고 off-day 가
18 과 5 였다 — 얇은 두 섹션에서 경계 정지가 걸리는 동안 빠른 네 섹션은 300 을 다
채웠다. 한 응답 안에서 양방향이 모두 동작한 것이다.

**2026-08-07 은 수집 밀도의 경계선이고, 이 날을 가로질러 날짜를 비교하면 안 된다.**
cap 300 으로 모은 날은 150 으로 모은 날보다 1.5배쯤 두껍다. 체 하니스의 라벨 4일은
전부 이 앞이라 영향이 없다. 서지(surge)는 각 날의 총계로 나누므로 영향이 없다.

앞으로 확인할 것은 응답의 **`off-day`** 필드다 — 03시·07시 실행에서는 크고 11시
이후에는 0 에 가까워야 한다.

그래도 자주 도는 쪽이 나은 이유는 그대로다 — **깊은 페이지는 오래된 기사고, 나중
실행은 새 기사다.** 실측으로 07시 크론 뒤 한 번 더 돌린 것만으로 **같은 150건 창
안에서 새 기사 404건**이 나왔다.

새 잡을 추가할 때 명령문에는 service-role 키가 평문으로 들어 있으므로,
**다시 붙여넣지 말고 기존 잡의 명령문을 그대로 복사한다**:

```sql
select cron.schedule(
  'collect-headlines-11kst',
  '0 2 * * *',
  (select command from cron.job where jobname = 'collect-headlines-daily')
);
```

분석기가 함수 안에 있으니 외부 한도라는 것이 없고, 여섯 번을 돌든 그보다 자주 돌든
비용은 스크래핑과 DB 왕복뿐이다. 실행당 4~5초다.

pg_cron 은 UTC 로 돈다. UTC 22:00 은 KST 로 **다음 날** 07:00 이지만, 함수가
`todayInSeoul()` 로 날짜를 정하므로 저장되는 `collected_date` 는 서울 날짜 그대로다 —
UTC 날짜로 찍었다면 하루 전 날짜에 쌓였을 자리다.

수집이 오전으로 옮겨진 이유는 하루 두 번 쌓이는 것을 막기 위해서다. 13:00 이었을 때는
오전에 작업하려면 손으로 한 번 돌려야 했고, 그러면 그날 13:00 크론이 두 번째 수집을
얹었다. 2026-08-01 이 정확히 그렇게 1,382 행이 되었고 (07-31 은 900), 라벨 세트가
조용히 무효화되었다 — `scripts/analysis/README.md` 의 규칙 4 를 볼 것. 그 중복 행들은
마이그레이션 0007 이 걷어냈고 (08-01 은 1,144, 07-31 은 899 가 되었다), 라벨 세트는
그때 한 번 더 움직였다.

이 SQL 에는 service_role key 가 평문으로 들어간다. SQL Editor 에서만 실행하고 저장소에는
커밋하지 않는다.
