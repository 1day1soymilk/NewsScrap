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
한참 적으면 `supabase/functions/collect-headlines/index.ts` 에서 조절한다:
- 유료 플랜이면 `RUN_BUDGET_MS` 를 `360_000` 으로 올린다
- 무료 플랜이면 `MAX_HEADLINES_PER_CATEGORY` 를 100 정도로 낮춘다

`WORKER_RESOURCE_LIMIT` 로 죽으면 응답이 없으므로 `summary` 를 읽을 수 없다. 그때는
로그의 `CHK` 줄이 어느 카테고리에서 멈췄는지 말해준다.

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

**한 번에 더 많이 긁는 쪽은 안 된다.** 섹션당 150건을 300건으로 올려 봤더니
63초에 `546 WORKER_RESOURCE_LIMIT` 으로 죽었다. 같은 날 아침 150건짜리 실행은
64.6초에 정상 종료했으므로 이 플랜의 벽은 문서가 말하는 150초가 아니라 63초
언저리다. 게다가 깊은 페이지는 오래된 기사고, 나중 실행은 새 기사다 — 실측으로
07시 크론 뒤 한 번 더 돌린 것만으로 **같은 150건 창 안에서 새 기사 404건**이
나왔다.

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
