# 라운드 16 — `0028`이 남긴 뒤처리 셋과 α 재개

> **이것은 실행 전에 쓴 설계 문서다.** 실행 결과는 `OPEN.md`와 각 README에 있고,
> 몇 군데는 계획과 다르게 끝났다. 그 차이가 이 문서를 남기는 이유이므로 고쳐
> 쓰지 않는다:
>
> - **B의 분기가 "안 움직였다" 쪽으로 떨어졌다.** 게이트가 지운 열두 단어는 전부
>   선을 안 가진 단어였고, 교차 관련 다섯 열이 열두 칸에서 하나도 안 움직였다.
>   평면화 단가는 재측정 없이 그대로 섰다.
> - **α는 예상보다 강하게 이겼다.** 계획은 "+0.26이 커지면"을 기대했는데, 실제로
>   나온 것은 평균이 아니라 **한 날도 안 지는 우세**였다. 판정을 평균으로 하지
>   말자고 계획에 적어 둔 것이 그대로 값을 했다.
> - **계획에 없던 결함 셋이 나왔다.** `day_edges`가 `eval_days`를,
>   `21_unlabeled_category.sql`이 `11_category_eval.sql`을, 그리고 어떤
>   워크리스트도 게이트 켠 화면을 안 따라가고 있었다. 셋 다 워크리스트가 아니라
>   하네스의 `unlab` 열이 잡았다.
> - **라벨은 250~350 예상에 304개였다.**

## Context

마이그레이션 `0028`(place gate ON)은 `scoring_weights` 한 줄만 바꿨는데, 게이트를
읽는 곳이 네 군데 더 있었다. 라운드 15가 그중 하나(하네스의 출하 설정 행)를
고쳤고 `OPEN.md`의 A·B·C가 나머지다. 지금 상태를 배포 DB에 대고 전부 재현했다.

- **A.** `30_word_scores.sql`이 게이트가 떨어뜨린 place에 거짓 `!`를 띄운다.
  오늘(08-08) `서울`(ov=`place`, 라벨 good)이 `cut: rank` + `!`다. 그 파일의
  `chk`는 두 값짜리 계약(일치 / `!`= *이 스크립트가* 틀림)이라, 세 번째 뜻이
  생기면 점검이 아니다.
- **B.** 레이아웃 픽스처가 게이트보다 오래됐다. 네 날 전부 움직였고 빠진 것은
  전부 place다.

  | 날 | nodes | edges | 빠진 것 |
  | --- | --- | --- | --- |
  | 07-31 | 70 → 70 | 45 → **47** | 서울 · 제주 |
  | 08-01 | 70 → 70 | 51 → 51 | 강남 · 울산 |
  | 08-02 | 69 → **68** | 54 → 54 | 부산 |
  | 08-03 | 70 → 70 | 63 → **66** | 서울 · 인천 · 포항 · 울산 · 강원 · 광주 |

- **C.** `11_category_eval.sql`에 sieve 6이 없다. 고칠 것이 아니라 기록할 것인데,
  기록이 `OPEN.md`에만 있어서 그 파일을 여는 사람은 못 읽는다.
- **α.** 라운드 15는 "그날 불균형에 따라 α를 켜기"를 **산술로** +0.26 F1이라
  적고 문턱 하나를 살 값이 못 된다며 닫았다. 그 뒤 불균형 있는 날이 두 개 더
  쌓였고 **둘 다 캡 150 시절**이라 기존 eval day와 같은 수집 체제다. 이제
  산술이 아니라 **설정으로 실측**할 수 있다.

  `category_balance_factors(d, 1)`로 뽑은 spread (라운드 15 표와 일치 확인):

  ```
  07-31 1.01 | 08-01 2.52 | 08-02 1.67 | 08-03 1.49
  08-04 2.44 | 08-05 2.48 | 08-06 2.21 | 08-07 3.77(캡 300, 체제 경계 너머)
  ```

목표는 A·B·C를 닫고, α를 **측정된 설정**으로 한 번 판정해 라운드 16으로 닫는
것이다. 형이 정한 것: α는 eval day 2일(08-05·08-06) 추가해 실측, 픽스처는 네 날
유지 + 08-04 별도 표, C는 파일 주석 + README 절 + 게이트 켠 탭 숫자 한 번 뽑기.

---

## 1. A — `30_word_scores.sql`의 거짓 `!`

**파일:** `scripts/analysis/30_word_scores.sql` (이 항목은 이 파일 하나뿐)

게이트를 다시 구현하지 않는다. 출하된 헬퍼가 게이트-오프 순위를 그대로 준다:

```sql
gate_off as (
  select r.word, r.is_place
  from public.keyword_graph_rank(
    array(select c from public.keyword_graph_candidates((select d from params), null) c),
    '{}'::text[]
  ) r
),
```

`keyword_graph_rank`의 `returns table`에 `is_place boolean`이 있다 (마이그레이션
`0024` 307행, `0025`가 시그니처 유지). `p_banned`가 비면 어떤 place도 안 막히므로
이 결과가 곧 게이트-오프 화면이다.

- `annotated`에 `left join gate_off go on go.word = s.word`.
- `verdicts`의 CASE에 `'cut: rank'` 바로 앞 절을 넣는다:
  `when go.word is not null and go.is_place then 'cut: place gate'`.
  (`gate_off`에 있다는 것은 이미 체 1~4를 통과하고 캡 안에 들었다는 뜻이므로
  앞의 `cut:` 가지들과 겹치지 않는다.)
- `chk`의 두 번째 가지에 예외를 건다 — 지금
  `rank is null and passes and (nodes 수) < render_cap`인 곳에
  `and not coalesce(go.is_place, false)`를 더한다.
- 헤더 29~40행 주석을 고친다. "게이트를 켜는 뒤 라운드는 손으로 넣어야 한다"가
  **이제 넣었다**로 바뀌고, `chk`가 여전히 못 보는 것(α 순서)만 남는다.

**검증.** `scripts/analysis/run.sh scripts/analysis/30_word_scores.sql`에서
`서울`이 `cut: place gate` / `chk` 공백. 그리고 **`!`가 한 줄도 없어야 한다.**
얇은 날에 잘 터지므로 오늘(08-08, 14노드)이 최선의 시험대다. 08-03 같은 두꺼운
날도 한 번(`params`의 `d`를 리터럴로 바꿔) 돌려 `!` 0을 확인한다.

---

## 2. C-1 — `11_category_eval.sql`의 한계를 그 파일에 적는다

**파일:** `scripts/analysis/11_category_eval.sql` (헤더 주석만, 코드 변경 없음)

`30_word_scores.sql`이 자기 사각지대를 자기 헤더에 적어 두는 것과 같은 형태로,
이 파일도 적는다: **여기의 모든 행은 게이트가 없는 화면이다.** 이유는 게이트가
(날, 카테고리)별 엣지 집합을 요구하는데 `analysis.day_edges`는 날 전체라,
변형을 만들면 sieve 6의 **세 번째 사본**이 된다는 것. 그래서 게이트의 탭 숫자는
배포 RPC에서 직접 뽑고 앞으로도 그래야 한다(→ 5절).

라운드 15의 컷 대 강등 비교는 두 팔이 **똑같이** 게이트 없이 재서 내부 비교로
유효했다는 문장도 같이 남긴다 — 이 한계가 그 라운드를 무효로 만들지 않는다는
것이 요점이다.

---

## 3. B — 레이아웃 픽스처를 게이트 위에서 다시 뜬다

**파일:** `scripts/layout/pullFixture.mjs`, `measure.ts`, `bridges.ts`,
`planarity.ts`, `graphDays.json`, 새 `graphDays.fat.json`, `README.md`,
`scripts/layout/OPEN.md`

### 3-1. 하네스가 픽스처 파일을 인자로 받게 한다

지금 네 파일 모두 `graphDays.json`을 하드코딩한다. 08-04를 **별도 표**로 재려면
두 번째 픽스처가 필요하고, 한 파일에 다섯 날을 넣으면 본 표가 다섯 날이 되어
전후 비교가 깨진다.

- `pullFixture.mjs`: 날 목록을 `process.argv[3..]`에서 받고, 없으면 지금의 네 날.
  (출력 경로는 이미 `argv[2]`.)
- `measure.ts` / `bridges.ts` / `planarity.ts`: 픽스처 경로를 `argv[2]`에서 받고
  없으면 `graphDays.json`. 기본 동작은 한 글자도 안 바뀐다.

### 3-2. 다시 뜨고 다시 잰다

```bash
node scripts/layout/pullFixture.mjs scripts/layout/graphDays.json
node scripts/layout/pullFixture.mjs scripts/layout/graphDays.fat.json 2026-08-04
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/measure.ts
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/measure.ts scripts/layout/graphDays.fat.json
```

`pullFixture.mjs`는 이미 `keyword_graph_compute`를 부르므로 캐시가 아니라 지금
설정이 그리는 그림이 온다. **뜬 시각을 표에 같이 적는다** — 이 가지가 안 밝힌
숫자로 세 번 물렸다.

### 3-3. 판정

- `overlap`은 12칸(3뷰 × 4날) 전부 **0이어야 한다**. 하나라도 넘으면 배치 결함.
- 판정은 총 `crossings`가 아니라 `xIn` / `xBr`로 쓴다.
- `width`를 `height`와 **짝으로** 적는다. 폭만 커지는 변화는 "자리를 더 쓴다"가
  아니라 "글자가 작아진다"이고, 그 둘은 다른 문제다.
- `drawn` < `edges`인 칸이 생기면 두 라벨이 붙어 선 자리가 없었던 것이므로
  그 자체로 기록한다.

### 3-4. 평면화 단가(4절) 재확인 — 분기가 있다

08-02에서 빠진 것은 `부산` 하나다. 4절의 판단이 매달린 것은 그 날의
**김민석·정청래·민주당 13단어 사건**이므로:

- **`부산`이 그 사건 밖이면** — `planarity.ts`가 그 사건을 여전히 13노드 29엣지,
  `forced` 52로 보고하면 — 4절 결론은 그대로다. "픽스처를 갈았고 그 사건은 안
  움직였다"만 `scripts/layout/README.md`와 `scripts/layout/OPEN.md` 2절에 적는다.
- **그 사건이 움직였으면** k 쓸기(1.0 / 1.3 / 2.0)를 다시 돌려 표를 갱신한다.
  **결론(폭이 값이다)은 안 바뀔 것이나 숫자는 바뀐다.** 상수는 건드리지 않는다 —
  이건 재확인이지 재개가 아니다.

### 3-5. 08-04 별도 표

"두꺼운 날의 캔버스"라는 새 절로 `scripts/layout/README.md`에 넣는다. 본 표와
**섞지 않는다** — 캔버스는 70단어로 고정이라 두꺼운 날이 바꾸는 것은 엣지
밀도이고, 그 그림은 이 하네스가 한 번도 안 재 봤다. 값은 그 자체로 읽고, 네 날
표와 평균 내지 않는다.

---

## 4. α — 라운드 16, 산술이 아니라 설정으로

### 4-1. eval day 두 날 추가

**파일:** `scripts/analysis/12_eval_days.sql`

```sql
('2026-08-05', '폭염'),   -- 169건
('2026-08-06', '폭염'),   -- 180건
```

`top_story`는 배포 RPC에서 읽었다(고른 것이 아니다). 08-07은 **넣지 않는다** —
`collect_cap` 300 체제 너머라 수집 깊이가 다르고, 12_eval_days.sql 헤더가 08-04를
"경계 직전의 마지막 날"로 고른 이유가 그대로 적용된다.

### 4-2. 게이트된 α를 진짜 설정으로 만든다

**파일:** 새 `scripts/analysis/27_round_sixteen_configs.sql`,
그리고 `10_sieve_eval.sql` · `20_unlabeled.sql`

라운드 15의 56.14/87.92는 **이미 잰 행 위의 산술**이지 실행이 아니었다. 실행이
되게 하려면 α가 날마다 달라질 수 있어야 한다.

- `analysis.sieve_configs`에 열 하나를 더한다. 라운드 14가 `render_cap` 등을
  더한 방식 그대로:
  ```sql
  alter table analysis.sieve_configs
    add column if not exists alpha_min_spread numeric;   -- null = 항상 적용(지금 동작)
  ```
- 하네스 두 곳의 α 슬라이스 조인을 **유효 α**로 바꾼다. 지금은
  `join sig s on s.balance_alpha = c.balance_alpha`인데, 그날의 spread가 문턱
  아래면 0을 쓴다:
  ```sql
  join sig s on s.balance_alpha = case
    when c.alpha_min_spread is null then c.balance_alpha
    when ds.spread >= c.alpha_min_spread then c.balance_alpha
    else 0
  end
  ```
  `ds`는 `category_balance_factors(d, 1)`의 max/min으로 만든 날별 spread CTE.
  **α = 0 슬라이스는 이미 `sig`에 있으므로 `keyword_signals` 호출이 안 늘어난다** —
  비용은 지금과 같다(활성 α 개수 × 날 수).
- **`alpha_min_spread`가 null이면 지금과 완전히 같은 조인**이므로 기존 120행은
  한 줄도 안 움직인다. 이걸 실행 전에 확인한다 — 설정 300의 출력이 패치 전후로
  행 단위 동일해야 한다(라운드 15가 `11_category_eval.sql`에 head_pos 축을
  더할 때 쓴 그 검증).

설정 (라운드 16 블록, 320번대):

| ord | 이름 | α | `alpha_min_spread` | 비고 |
| --- | --- | --- | --- | --- |
| 300 | r15: SHIPPED (gate on) | 0 | null | 대조군, 재활성 |
| 310–313 | r15: alpha .25 / .50 / .75 / 1.00 | 평평 | null | 이미 있음, 7일 위에서 재측정 |
| 320 | r16: alpha 1.00, spread ≥ 1.2 | 1.00 | 1.2 | 새로 |
| 321 | r16: alpha .50, spread ≥ 1.2 | 0.50 | 1.2 | 새로 |
| 322 | r16: alpha 1.00, spread ≥ 1.6 | 1.00 | 1.6 | 새로 |
| 323 | r16: alpha 1.00, spread ≥ 2.0 | 1.00 | 2.0 | 새로 |

활성 α 값은 {0, .25, .50, .75, 1.00} 다섯 개 그대로다. 게이트된 설정은 그중
둘을 재사용할 뿐이라 `keyword_signals` 호출이 안 늘어난다 — 늘어나는 것은 날
수(5 → 7)뿐이다.

**문턱은 고원이고 그렇게 보고한다.** 일곱 날의 spread가 1.01 하나와
1.49~2.52 여섯이라 (1.01, 1.49] 안의 어떤 값도 같은 분할을 준다. 322·323은
분할을 실제로 바꾸는 두 지점(1.6은 08-03을 뺀다, 2.0은 08-02·08-03을 뺀다)이라
**모양을 보이기 위한 것**이지 최적점을 찾기 위한 것이 아니다. `min_standalone`이
0.10에서 고원 한가운데라 취해진 것과 같은 형태로 쓴다.

### 4-3. 라벨링 — 이 라운드에서 제일 무거운 일

**파일:** 새 `scripts/analysis/28_labels_round_sixteen.sql`

순서를 지킨다. **설정을 활성화한 뒤에 워크리스트를 돌린다** — 활성 설정이 화면을
바꾸고, 승격된 단어가 곧 규칙 4가 잡으라는 것들이다.

```bash
run.sh 12_eval_days.sql
run.sh 27_round_sixteen_configs.sql
run.sh 20_unlabeled.sql       # α 슬라이스별로 다 본다
run.sh 21_unlabeled_category.sql
```

**측정한 규모:** 출하 설정(α=0)만으로도 08-05·08-06 화면(일 단위 + 6탭)에
435단어가 오르고 그중 **251개가 라벨이 없다.** α 변형이 더 승격시키므로 실제
숫자는 250~350 사이일 것이다. 현재 라벨은 1,223개(good 428 / bad 795)이고,
라운드 15가 224개를 한 번에 붙였으므로 규모 자체는 전례가 있다.

라벨 기준은 이 저장소가 이미 정한 **운영적 질문**을 쓴다: *이 단어가 아무 다른
주의 뉴스에도 나오겠는가?* 나오면 bad(압수수색·본회의), 안 나오면 good. 그리고
**섹션 태그는 주제가 아니다** — `spec` 1.00에 대괄호 접미사를 공유하는 것은
신문사 자기 가구다.

**멈춤 조건:** `20_unlabeled.sql`과 `21_unlabeled_category.sql`이 둘 다 0행.
그 전에는 어떤 수치도 읽지 않는다.

### 4-4. 측정과 판정

```bash
run.sh 10_sieve_eval.sql      # 일 단위, 7일
run.sh 11_category_eval.sql   # 탭, 42셀(7일 × 6섹션)
```

- **`unlab`이 0이 아닌 행은 무의미하다.** 먼저 확인한다.
- **7일 평균으로 판정하지 않는다.** 이것이 이 라운드의 함정이다 — 새로 넣은 두
  날이 둘 다 불균형이라, 날 집합이 이제 불균형 6 : 균형 1이다. 그 위에서
  게이트된 α가 평균으로 이기는 것은 거의 항등식이다. **판정은 날별·셀별로 한다:**
  - 게이트된 α는 07-31(spread 1.01)에서 **α=0과 정확히 동일해야 한다**(구성상).
    아니면 구현이 틀린 것이다.
  - 불균형 날들에서 셀 단위로 α=0을 이기는가, 아니면 평평한 α와 같은가.
  - `story_rank` — α가 그날 제일 큰 이야기를 떨어뜨리면 그 자리에서 기각(규칙 5).
- **탭은 대조군이지 측정이 아니다.** α는 카테고리 탭 안에서 구성상 항등이므로
  `11_category_eval.sql`은 "안 움직였다"를 확인하는 자리다. 움직였으면 버그다.

### 4-5. 결론을 어느 쪽으로든 기록한다

- **켜면** — 마이그레이션 `0035`가 `category_balance_alpha`를 올리는데, 그
  게이팅은 DB 쪽에도 있어야 한다(`keyword_signals`의 α 기본값이 상수 하나라
  날별 분기가 없다). 이건 **적지 않은 작업**이고, 승격이 확정된 뒤에 별도
  항목으로 연다. `scoring_weights` 변경 마이그레이션은 하네스의 출하 설정 행을
  **같은 숨에** 바꿔야 한다(이번 세션이 남긴 습관).
- **안 켜면** — 라운드 14의 `0026`이 한 것처럼, 값을 안 움직이고 이유만
  적는다. 라벨 250여 개와 두 날은 그대로 남아 다음 라운드의 자산이 된다.

어느 쪽이든 `scripts/analysis/README.md`에 "Round sixteen" 절을 쓴다.

---

## 5. C-2 — 게이트 켠 탭 숫자를 한 번 뽑아 남긴다

**파일:** 새 `scripts/analysis/29_gate_on_category.sql`

4-3의 라벨링이 끝난 **뒤에** 돌린다. 그 전에는 08-05·08-06 셀이 `unlab`을 낼
것이고, 그러면 규칙 4에 따라 못 읽는다.

배포 RPC에서 직접 뽑는다 — `analysis.day_edges`에 (날, 카테고리) 변형을 만들면
sieve 6의 세 번째 사본이 되기 때문이고, 그 금지가 C의 내용 그 자체다.

```sql
-- 날 × 6섹션의 keyword_graph_compute(d, cat) 노드 집합을 라벨에 붙인다.
```

지표는 `11_category_eval.sql`의 것을 **그대로** 쓴다(공식을 새로 쓰면 재는
대상이 달라진다). 그 파일 202~220행:

- `prec = good / (good + bad)`
- `recall = good / good_pool`, `good_pool` = 그 섹션에 존재하고 **일 단위**
  `df >= 3`인 labelled-good 단어 수
- `f1 = 2·good / (2·good + bad + (good_pool − good))`

결과를 `scripts/analysis/README.md`에 표로 남기고, **`11_category_eval.sql`의
게이트-오프 숫자와 나란히 놓지 않는다** — 서로 다른 화면이라 비교 대상이 아니다.
같이 놓을 수 있는 것은 이 표와 라운드 14가 게이트 판정에 쓴 78.58 → 75.22뿐이고,
그것도 라벨 집합이 그 뒤 두 번 늘었으므로 **숫자끼리 비교하지 말라**는 규칙이
그대로 적용된다는 문장을 붙인다.

---

## 6. 마무리 — 대기열과 문서

- **`OPEN.md`**: A·B·C를 "닫힘 (2026-08-08)"으로 옮기고 **무엇이 닫았는지** 적는다
  (지우지 않는다). "그 밖에 다시 열 만한 것"의 α 항목은 라운드 16의 판정으로
  대체한다. 켜기로 했다면 새 열린 항목 하나가 생긴다 — "게이팅을 DB 쪽에 싣기".
- **`scripts/layout/OPEN.md`** 2절에 픽스처를 갈았다는 한 줄과 4절 재확인 결과.
- **`CLAUDE.md`**: 움직인 것만. `30_word_scores.sql`의 사각지대 문장이 이제
  "게이트는 보인다, α 순서는 여전히 안 보인다"로 바뀌고, α가 켜졌다면 그 절
  전체가 다시 쓰인다. **문자 수 한도 150,000을 넘기지 않는다** — 지금 126k이고,
  넘치면 꼬리가 조용히 잘린다. 서사는 각 README에 두고 여기엔 금지문 한 줄만.
- **설계 문서**: `docs/superpowers/specs/2026-08-08-round-sixteen-design.md`로
  이 계획을 커밋한다(저장소 관례).

## 검증

각 절이 끝날 때마다 그 절의 자기 검증(위에 적음)을 통과해야 한다. 그리고 전체
게이트는 매번:

```bash
npm run build && npx vitest run && npm run lint && npm run test:e2e
```

**`npm run build`가 진짜 관문이다** — `npm test`만으로는 컴파일 안 되는 코드도
통과한다. 이번 작업에서 `src/`를 건드리는 것은 없으므로 단위/e2e는 안 움직여야
정상이고, **움직이면 그것이 신호다**.

기준선: `main` = `4341edf`, 빌드 0 / 단위 372 / e2e 50.

## 실행 방식

- 격리된 워크트리에서 작업하고, `main` 머지는 형이 직접 한다.
- 승인 뒤에는 `superpowers:executing-plans`를 붙여 절 단위 체크포인트로 진행한다.
- **1·2절은 α와 독립**이라 먼저 닫아 커밋한다. 3절도 독립. 4절이 제일 길고
  5절은 4절의 라벨링에 매달려 있다.
