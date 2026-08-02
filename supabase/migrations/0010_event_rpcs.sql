-- supabase/migrations/0010_event_rpcs.sql
--
-- 사건 단위의 기사 수와 헤드라인. 둘 다 클라이언트가 할 수 없는 일을 한다.
--
-- 지금 화면의 "오늘의 톱 스토리"가 부르는 숫자는 멤버 단어들의 count를 더한
-- 값이고, 한 기사가 사건의 두 단어를 물면 두 번 세어진다. 그래서 그것은 사건의
-- 기사 수가 아니라 (기사, 단어) 쌍의 수다. 실측한 배율은 1.10에서 2.22 사이이고
-- **사건마다 다르며 단어 수와 함께 커지므로, 표시만이 아니라 순위가 틀린다** —
-- 2026-08-01의 실제 1위는 트럼프(합계 73 / 실제 51)가 아니라 폭염(69 / 61)이다.
--
-- 클라이언트가 이것을 고칠 수 없는 이유는 둘이다. headline_nouns를
-- .in('word', words)로 읽어 headline_id를 유일화하면 (1) 08-02의 가장 큰 사건이
-- 이미 164행이고 이 수는 사건의 단어 수와 함께 자라므로 PostgREST의 1000행
-- 상한에 잘릴 수 있고, (2) 응답을 세어 수를 만드는 것은 CLAUDE.md가 금지한
-- 바로 그 동작이다. count(distinct …)는 PostgREST가 표현할 수 없다.
--
-- 사건 분할은 클라이언트의 루뱅에서 나오므로 서버가 미리 계산해 둘 수 없다.
-- 따라서 사건이 정해진 뒤 한 번 더 물어보는 형태가 된다.
--
-- 데이터는 건드리지 않는다. drop function 둘로 완전히 되돌아간다.

-- 사건마다 그 멤버 단어 중 하나라도 물고 있는 헤드라인의 수. 유일화는 헤드라인
-- id로 한다.
--
-- p_events는 단어 배열의 배열이고, 반환은 **같은 순서의** 정수 배열이다. 목록
-- 전체가 한 번의 왕복으로 끝난다. 순서가 어긋나면 사건에 남의 기사 수가 붙고
-- 화면상 그럴듯해 보이므로, ordinality를 끝까지 들고 가서 그 순서로 집계한다.
--
-- p_category가 null이면 전체 보기다. keyword_graph의 scoped CTE와 같은 필터를
-- 쓰므로 화면에 있는 것과 같은 것을 센다.
create function event_headline_counts(
  p_date date,
  p_category text default null,
  p_events jsonb default '[]'::jsonb
)
returns json
language sql
stable
set search_path = ''
as $fn$
with scoped as (
  select distinct h.id as headline_id, n.word
  from public.headline_nouns n
  join public.headlines h on h.id = n.headline_id
  join public.categories c on c.id = h.category_id
  where h.collected_date = p_date
    and (p_category is null or c.slug = p_category)
),
ev as (
  select
    e.ordinality - 1 as idx,
    array(select jsonb_array_elements_text(e.value)) as words
  from jsonb_array_elements(p_events) with ordinality as e(value, ordinality)
)
select coalesce(
  (
    select json_agg(t.n order by t.idx)
    from (
      select
        ev.idx,
        (
          select count(distinct s.headline_id)
          from scoped s
          where s.word = any(ev.words)
        )::int as n
      from ev
    ) t
  ),
  '[]'::json
);
$fn$;

comment on function event_headline_counts(date, text, jsonb) is
  '사건별 중복 제거 기사 수. 입력 순서 그대로 돌려준다.';

-- 클릭한 사건의 헤드라인. fetchHeadlinesForWord의 200행 상한을 사건 경로에
-- 그대로 쓰면 74건짜리 사건이 164행을 소비해 여유가 22%밖에 없으므로, 상한을
-- 올리는 대신 서버에서 유일화해 상한 자체를 없앤다.
--
-- 한 기사가 두 섹션에 실린 경우는 여기서 두 행으로 남는다 — id가 다르기
-- 때문이고, HeadlinePanel의 dedupe()가 기사 id 경로로 다시 접는다. 그 동작은
-- 지금과 같다.
create function event_headlines(
  p_date date,
  p_category text default null,
  p_words text[] default '{}'
)
returns json
language sql
stable
set search_path = ''
as $fn$
select coalesce(
  (
    select json_agg(
      json_build_object(
        'id', t.id,
        'title', t.title,
        'link', t.link,
        'category_slug', t.slug
      )
      order by t.slug, t.title
    )
    from (
      select distinct h.id, h.title, h.link, c.slug
      from public.headline_nouns n
      join public.headlines h on h.id = n.headline_id
      join public.categories c on c.id = h.category_id
      where h.collected_date = p_date
        and (p_category is null or c.slug = p_category)
        and n.word = any(p_words)
    ) t
  ),
  '[]'::json
);
$fn$;

comment on function event_headlines(date, text, text[]) is
  '사건 멤버 단어 중 하나라도 문 헤드라인, 헤드라인 id로 유일화.';

-- SQL 함수는 기본이 SECURITY INVOKER이므로 select 전용 정책이 그대로 산다.
-- keyword_graph와 같이 anon에게 execute를 준다.
grant execute on function event_headline_counts(date, text, jsonb) to anon, authenticated;
grant execute on function event_headlines(date, text, text[]) to anon, authenticated;
