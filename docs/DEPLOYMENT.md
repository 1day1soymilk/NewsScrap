# 배포 절차

## 사전 준비 (사용자 직접)

1. **Supabase 프로젝트 생성** — [supabase.com](https://supabase.com)
   - **Postgres 15 이상**이어야 한다. 마이그레이션의 `create view ... with (security_invoker = on)` 은
     PG14 이하에서 문법 에러로 `db push` 가 실패한다. 지금 생성되는 신규 프로젝트는 PG15+ 이므로
     기본값 그대로 두면 된다.
   - Project Settings → API 에서 **Project URL**, **anon key**, **service_role key** 를 복사해 둔다.
   - Project Settings → General 의 **Reference ID** 도 복사해 둔다 (`<project-ref>`).

2. **ETRI API 키 발급** — [epretx.etri.re.kr](https://epretx.etri.re.kr) 회원가입 후 발급
   - 구 포털 `aiopen.etri.re.kr` 은 **2025-06-30 운영 종료**됐다 (현재 인증서도 만료 상태).
     e-PreTX 가 공식 후속 플랫폼이고 WiseNLU 를 동일한 요청/응답 스키마로 제공한다.
     엔드포인트만 `http://epretx.etri.re.kr:8000/api/WiseNLU` 로 바뀌었다.
   - 한도는 5,000 호출/일. 이 함수는 1회 실행당 최대 900회
     (6 카테고리 × 150 헤드라인) 호출한다. 첫 실행만 900건 전부가 신규이고
     이후에는 중복이 ETRI 호출 없이 걸러지므로 일 1회 스케줄이면 여유가 있다.

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

# Edge Function 시크릿. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는
# Supabase 런타임이 자동 주입하므로 ETRI 키만 등록하면 된다.
npx supabase secrets set ETRI_API_KEY=<발급받은 키>

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

**실행 시간:** 카테고리당 150건, 총 900건을 동시성 8로 처리해 90초 안팎을 예상한다.
Edge Function wall-clock 한도는 무료 150초 / 유료 400초다.

함수는 예산을 초과하면 죽는 대신 스스로 멈춘다. `RUN_BUDGET_MS`(110초)를 카테고리 6개로
나눠 각자 몫을 주므로, 느린 실행에서도 특정 카테고리만 계속 굶는 일은 없다. 처리하지 못한
헤드라인은 다음 실행이 이어받는다 (중복은 ETRI 호출 없이 걸러지므로 2회차부터 빠르다).

`summary` 에 `skipped: run budget exhausted` 가 보이거나 `processed` 가 `collected` 보다
한참 적으면 `supabase/functions/collect-headlines/index.ts` 에서 조절한다:
- 유료 플랜이면 `RUN_BUDGET_MS` 를 `360_000` 으로 올린다
- 무료 플랜이면 `MAX_HEADLINES_PER_CATEGORY` 를 100 정도로 낮춘다

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

pg_cron 은 UTC 로 돈다. UTC 22:00 은 KST 로 **다음 날** 07:00 이지만, 함수가
`todayInSeoul()` 로 날짜를 정하므로 저장되는 `collected_date` 는 서울 날짜 그대로다 —
UTC 날짜로 찍었다면 하루 전 날짜에 쌓였을 자리다.

수집이 오전으로 옮겨진 이유는 하루 두 번 쌓이는 것을 막기 위해서다. 13:00 이었을 때는
오전에 작업하려면 손으로 한 번 돌려야 했고, 그러면 그날 13:00 크론이 두 번째 수집을
얹었다. 2026-08-01 이 정확히 그렇게 1,382 행이 되었고 (07-31 은 900), 라벨 세트가
조용히 무효화되었다 — `scripts/analysis/README.md` 의 규칙 4 를 볼 것.

이 SQL 에는 service_role key 가 평문으로 들어간다. SQL Editor 에서만 실행하고 저장소에는
커밋하지 않는다.
