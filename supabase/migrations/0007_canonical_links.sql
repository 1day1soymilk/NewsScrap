-- supabase/migrations/0007_canonical_links.sql
--
-- 한 기사에 한 링크. 아카이브를 정규형으로 한 번 정리한다.
--
-- 섹션 첫 페이지는 인라인 HTML로 /mnews/article/{press}/{id}를 주고, "더보기"
-- 페이지네이션은 같은 기사에 /article/{press}/{id}를 준다. index.ts의 중복 검사는
-- 링크 문자열 전체를 맞춰 보므로 두 형식을 다른 기사로 봤다. 반대로 같은
-- 카테고리·같은 형식으로 중복된 행은 세 수집일 통틀어 0건이다 — 검사 자체는
-- 형식 안에서 완벽하게 동작했고, 새는 곳은 이 경계 하나뿐이었다.
--
-- 잡히는 것은 같은 날 중복(08-01 184건, 나머지 날은 한 자릿수 — 이 184건은
-- 같은 카테고리 안의 중복이고, 186건 중 나머지 2건은 한 기사가 두 섹션에 걸린
-- 것이라 아래에서 그대로 남긴다)보다 날짜를 건너뛰는 중복 쪽이 크다. 08-02
-- 수집분 838행 중 143행(17.1%)이 08-01에 이미 저장돼 있던 기사였다.
--
-- 실제로 그려지는 노드 수는 08-01·08-02 모두 70 그대로다. 다만 엣지는 사전
-- 예측("하나도 사라지지 않는다")과 달리 움직였다 — 08-01은 47→36, 08-02는
-- 57→58. 그날 최대 사건은 그대로다(김민석 46→46, 08-02 기준). 사전 예측이
-- 틀린 이유: 그 점검은 기존에 그려지던 70단어 집합을 고정해 두고 그 안에서만
-- co-occurrence를 다시 세었다. 엣지는 그려지는 노드 사이에만 존재하는데, 랭킹이
-- 이동하면 어떤 70단어가 그려지는지 자체가 바뀌므로, 그려지는 노드 집합을
-- 고정한 점검은 그려지는 그래프에 대한 점검이 아니다. 임계값은 하나도 건드리지
-- 않으므로 10_sieve_eval.sql을 통과할 일이 아니다. 다만 08-01은 라벨된 두 날 중
-- 하나이므로, 다음에 체를 재려면 20_unlabeled.sql을 먼저 다시 돌려야 한다.
--
-- 이 SQL의 /article/(\d+/\d+)는 lib/headlines.ts의 ARTICLE_PATH_RE보다 일부러
-- 느슨하다 — 후자는 꼬리에 (?:[/?#]|$) 경계를 요구하지만 이 마이그레이션은
-- 요구하지 않는다. 실제 데이터(3,120행)에서는 영향받는 행이 0건으로 확인됐다.
-- 이 마이그레이션이 앞으로 다시 돌아갈 데이터베이스가 있다면 그때는 테이블이
-- 비어 있으므로 여전히 무해하다.
--
-- 순서가 중요하다: 삭제가 먼저다. 링크를 먼저 정규형으로 바꾸면 그 즉시
-- UNIQUE (category_id, link) 위반이 난다.
--
-- 재실행해도 안전하다. 한 번 돌고 나면 중복도 비정규형 링크도 남지 않으므로 두
-- 문장 모두 0행에 영향을 준다.

-- 1) (category_id, article_key)별로 가장 이른 목격만 남긴다. 가장 이른 것을
--    남기는 것이 "기사는 처음 본 날에 센다"와 일치한다 — index.ts의 조회에
--    날짜 조건이 없다는 것이 원래 그 뜻이었고, 링크 정규화가 그것을 비로소
--    지켜지게 만든다. headline_nouns의 FK는 ON DELETE CASCADE라 명사는 따라
--    지워진다.
--
--    카테고리를 가로지르는 중복(하루 1~2건, 한 기사가 두 섹션에 걸린 경우)은
--    partition에 category_id가 들어 있으므로 자연히 남는다. 기사가 실제로 두
--    섹션에 걸린 것이므로 두 행이 맞다.
with ranked as (
  select id,
         row_number() over (
           partition by category_id, substring(link from '/article/(\d+/\d+)')
           order by collected_date, created_at, id
         ) as rn
  from headlines
  where link ~ '/article/\d+/\d+'
)
delete from headlines h
using ranked r
where h.id = r.id
  and r.rn > 1;

-- 2) 남은 행을 정규형으로. 정규식에 걸리지 않는 링크는 건드리지 않는다 —
--    canonicalLink도 그런 href는 원본 그대로 통과시킨다.
update headlines
set link = 'https://n.news.naver.com/article/' || substring(link from '/article/(\d+/\d+)')
where link ~ '/article/\d+/\d+'
  and link is distinct from
      'https://n.news.naver.com/article/' || substring(link from '/article/(\d+/\d+)');
