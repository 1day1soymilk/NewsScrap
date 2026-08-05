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

응답 JSON 의 `summary` 에 6개 카테고리가 모두 `ok: ... seen, ... processed, ... new` 형태로
나와야 한다. 어느 하나라도 `failed:` 면 그 메시지가 원인이다.

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

막는 것은 예산이 아니라 **날짜 도장**이다. `collected_date` 는 수집한 날이고 깊은
페이지는 오래된 기사라, 자정을 넘겨 긁으면 어제 뉴스가 오늘로 저장된다. 20:10 KST
실측(깊이 400위까지의 표 기준)으로 사회·경제·정치는 400위까지 긁어도 오늘을
벗어나지 않지만 (사회는 400위가 4시간치다) 생활/문화와 IT 는 290위 언저리에서
08-03 으로 넘어간다. cap 을 300 으로 한 실행 하나가 그런 행 7개(278-296위, 전부
IT)를 저장했다.

**이 실측은 하루 중 한 시점만 본다.** 전부 20:10-21:10 KST 안에서 잰 것이고, 이
구간은 자정을 넘길 가능성이 가장 낮은 구간이다 — 빠른 섹션들은 이미 날짜 경계
앞에 하루치 뉴스 대부분을 확보한 상태다. cap 을 올릴 일이 생기면 확인할 것은
저녁 실행이 아니라 **03:00, 07:00 실행의 어제-날짜 행 수**다. 그 두 실행이 깊은
페이지가 어제로 가장 깊이 들어가는 반대쪽 상황이고, 필요할 때 임의로 재현할 수
없어 이번에는 재지 못했다.

다만 그 효과는 **150 에서도 이미 있다**: 02:29 와 07:00 실행이 08-03 에 나온 기사를
생활/문화 89건, IT 64건, 세계 43건 저장했다. 02:29 에는 오늘 뉴스가 2.5시간치뿐이라
150건 창이 자정 너머까지 닿는다. `UNIQUE (category_id, link)` 이 날짜별이 아니라
전역이라, 어제 이미 수집한 기사는 다시 찍히지 않는다 — 새로 찍히는 것은 어제
수집이 놓친 구멍뿐이다.

그리고 cap 은 실제로 걸린다: 2026-08-04 의 11시·15시·19시 실행에서 사회가 정확히
150건을 저장했다. 사회는 시간당 75건쯤 나오므로 150건 창은 4시간 간격의 절반도
못 덮는다. 나머지는 영영 잃는다.

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
