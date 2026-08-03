-- scripts/analysis/20_unlabeled.sql
--
-- Every word that reaches the screen under any configuration in
-- analysis.sieve_configs but carries no label yet. This is the worklist that
-- makes rule 4 satisfiable: while it returns rows, the harness numbers are
-- measuring a fraction of the screen and cannot be compared.
--
-- Taking only the extreme configurations is not enough, which is why this reads
-- the same table the harness does, active rows and all — the two must agree on
-- which configurations are in play or this list is short exactly where it
-- matters. A tighter sieve removes words from the top 70
-- and pulls deeper-ranked ones up to fill the gap, so each configuration puts a
-- slightly different set on screen — and those promoted words are precisely the
-- ones rule 4 exists to catch.
--
-- The signal columns are here so a judgement call has its evidence beside it: a
-- low `standalone` usually means the word is a piece of a compound, and `days`
-- says whether it recurs or belongs to one day's news.
--
--   scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql
--
-- The days come from analysis.eval_days, the same table 10_sieve_eval.sql reads,
-- for the reason above applied to days rather than to configurations: a day the
-- harness scores and this file does not is a day whose promoted words are never
-- put in front of anyone to label.

with
params as (select d from analysis.eval_days),
top_n (n) as (values (70)),

sig as (
  select p.d, s.*
  from params p
  cross join lateral keyword_signals(p.d) s
),

passed as (
  select
    c.ord, s.d, s.word, s.df, s.spec, s.standalone, s.neighbors_per_doc,
    row_number() over (partition by c.ord, s.d
      -- 강등: 제목 뒤에 앉는 단어를 자르지 않고 상한 아래로 밀어낸다.
      -- 자르면 카테고리 탭에서 24셀 중 8셀을 지고 한 셀도 못 이긴다 —
      -- 탭에는 상한이 걸리지 않아 잘린 자리를 메울 단어가 없기 때문이다.
      order by (s.head_pos > c.demote_head_pos) asc, s.df desc, s.word) as rank
  from analysis.sieve_configs c
  cross join sig s
  left join word_overrides ov on ov.word = s.word
  where c.active
    and s.df >= c.min_headlines
    and s.standalone >= c.min_standalone
    and s.head_pos <= c.max_head_pos
    and (not c.use_dict or ov.mode is distinct from 'exclude')
    and (
      char_length(s.word) >= c.min_word_len
      or s.spec >= c.min_spec
      or s.neighbors_per_doc <= c.max_npd
      or (c.use_dict and ov.mode = 'allow')
    )
),

shown as (
  select p.* from passed p cross join top_n where p.rank <= top_n.n
)

select
  s.word,
  max(s.df)::int                     as max_df,
  count(distinct s.d)::int           as days,
  round(max(s.spec), 2)              as spec,
  round(min(s.standalone), 2)        as standalone,
  round(min(s.neighbors_per_doc), 2) as npd
from shown s
left join analysis.word_labels l on l.word = s.word
where l.word is null
group by s.word
order by max(s.df) desc, s.word;
