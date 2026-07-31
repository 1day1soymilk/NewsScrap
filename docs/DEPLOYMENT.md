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
   - 한도는 5,000 호출/일. 이 함수는 1회 실행당 최대 240회
     (6 카테고리 × 40 헤드라인) 호출하므로 일 1회 스케줄이면 여유가 크다.

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

**타임아웃 주의:** 헤드라인 1건당 ETRI 왕복 ~0.5초 + DB 호출 몇 번이 순차로 일어난다.
최초 실행은 240건 전부가 신규라 가장 오래 걸린다. Edge Function 의 wall-clock 제한에 걸려
응답이 끊기면 `supabase/functions/collect-headlines/index.ts` 의
`MAX_HEADLINES_PER_CATEGORY` (현재 40) 를 20 정도로 낮추고 재배포한다. 2회차부터는 중복
헤드라인을 건너뛰므로 훨씬 빨라진다.

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
  '0 22 * * *', -- UTC 22:00 = KST 07:00
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

이 SQL 에는 service_role key 가 평문으로 들어간다. SQL Editor 에서만 실행하고 저장소에는
커밋하지 않는다.
