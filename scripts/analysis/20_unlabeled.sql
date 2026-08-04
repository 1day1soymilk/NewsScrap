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
-- matters. A tighter sieve removes words from the render cap's cutoff — now a
-- column, `render_cap`, rather than the literal 70 this file used to carry —
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

sig as (
  select p.d, s.*
  from params p
  cross join lateral keyword_signals(p.d) s
),

-- Sieve 6 is deliberately not applied here. It judges a place against the set
-- that is actually drawn, and "drawn" cannot be known until sieves 1-5 have
-- already produced a ranking against the render cap — that is what drawn0 and
-- gate_fail below are for. passed0 carries the columns the later CTEs and the
-- final re-rank need (head_pos, demote_head_pos, render_cap, place_gate)
-- alongside the signal columns this file reports (spec, standalone, npd).
passed0 as (
  select
    c.ord, s.d, s.word, s.df, s.spec, s.standalone, s.neighbors_per_doc,
    s.head_pos, c.demote_head_pos, c.render_cap, c.place_gate,
    row_number() over (partition by c.ord, s.d
      -- 강등: 제목 뒤에 앉는 단어를 자르지 않고 상한 아래로 밀어낸다.
      -- 자르면 카테고리 탭에서 24셀 중 8셀을 지고 한 셀도 못 이긴다 —
      -- 탭에는 상한이 걸리지 않아 잘린 자리를 메울 단어가 없기 때문이다.
      order by (s.head_pos > c.demote_head_pos) asc, s.df desc, s.word) as rank0
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
      -- 사체 4d: 두 글자여도 고유명사면 살린다. 길이 절은 "조각이 아니라 온전한
      -- 단어인가"의 대리 지표일 뿐이고, 분석기가 그 질문에 직접 답한다.
      or s.proper >= c.min_proper
      or s.neighbors_per_doc <= c.max_npd
      or (c.use_dict and ov.mode = 'allow')
    )
),

-- The set sieve 6 judges places against: rank <= render_cap *without* the
-- gate. See 10_sieve_eval.sql for why — this file has to match it clause for
-- clause or the two worklists can disagree about which words need labelling.
drawn0 as (
  select p0.* from passed0 p0 where p0.rank0 <= p0.render_cap
),

-- Sieve 6, as a cut inside the harness's own copy. A place in drawn0 survives
-- only if it holds a line — cooc and npmi already filtered into
-- analysis.day_edges, npmi checked here — to a partner that is *also* in
-- drawn0 and is not itself a place. Testing against day_edges alone (any
-- co-occurring non-place word, drawn or not) was this file's bug, matching
-- 10_sieve_eval.sql's: 부산 on 2026-08-02 survived through 경기, a word that
-- clears no sieve-4 clause and was never itself on screen. Migration 0024's
-- header is explicit that "has an edge" means "has a line on screen".
--
-- See 10_sieve_eval.sql for what actually checks this second copy against
-- keyword_graph — 30_word_scores.sql's `chk` does not reach it, since
-- `is_place` is deliberately absent from keyword_graph's JSON.
gate_fail as (
  select d0.ord, d0.d, d0.word
  from drawn0 d0
  join word_overrides ov on ov.word = d0.word and ov.mode = 'place'
  where d0.place_gate
    and not exists (
      select 1
      from analysis.day_edges de
      where de.d = d0.d and de.npmi >= 0.3
        and (
          (de.a = d0.word and de.b_is_place_false
            and exists (select 1 from drawn0 p2
                        where p2.ord = d0.ord and p2.d = d0.d and p2.word = de.b))
          or (de.b = d0.word and de.a_is_place_false
            and exists (select 1 from drawn0 p2
                        where p2.ord = d0.ord and p2.d = d0.d and p2.word = de.a))
        )
    )
),

-- The final ranking: passed0 minus the places gate_fail names, re-ranked by
-- the same order passed0 used, so the cap refills from whatever ranked next —
-- unchanged from how promotion already worked before sieve 6 existed. When
-- place_gate is false, gate_fail is empty by construction, so passed is
-- byte-identical to passed0.
passed as (
  select
    p0.ord, p0.d, p0.word, p0.df, p0.spec, p0.standalone, p0.neighbors_per_doc,
    row_number() over (partition by p0.ord, p0.d
      order by (p0.head_pos > p0.demote_head_pos) asc, p0.df desc, p0.word) as rank
  from passed0 p0
  where not exists (
    select 1 from gate_fail gf
    where gf.ord = p0.ord and gf.d = p0.d and gf.word = p0.word
  )
),

-- The render cap is now a column rather than the literal that used to sit
-- here, so 20_unlabeled.sql cannot silently score a different screen than
-- 10_sieve_eval.sql does — see that file and 24_cap_and_place_configs.sql.
shown as (
  select p.*
  from passed p
  join analysis.sieve_configs c on c.ord = p.ord
  where p.rank <= c.render_cap
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
