-- scripts/analysis/10_sieve_eval.sql
--
-- Scores every configuration in analysis.sieve_configs against
-- analysis.word_labels and prints one row per (configuration, day). This is the
-- only sanctioned way to change a threshold in scoring_weights.
--
--   scripts/analysis/run.sh scripts/analysis/12_eval_days.sql
--   scripts/analysis/run.sh scripts/analysis/02_sieve_configs.sql
--   scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql    -- must be empty
--   scripts/analysis/run.sh scripts/analysis/10_sieve_eval.sql
--
-- Read `unlabeled` before reading anything else. If it is not 0 the row is
-- measuring a fraction of the screen and means nothing — see README.md, rule 4.
--
-- Signals come from keyword_signals(), the same function keyword_graph() uses, so
-- what is measured here is what ships. Do not reimplement the formulas.
--
-- The days come from analysis.eval_days rather than from a literal list here,
-- so this file and 20_unlabeled.sql cannot drift apart on which days they cover.

with
params as (select d from analysis.eval_days),

sig as (
  select p.d, s.*
  from params p
  cross join lateral keyword_signals(p.d) s
),

-- Selection is by frequency, and `demote_head_pos` is the one thing that has
-- ever been allowed to disturb that — it is what round six is asking about, so
-- it is a knob here rather than a change. With it at its default (9.9) this
-- expression is exactly `order by s.df desc, s.word` and every earlier round's
-- numbers reproduce. Ties break on the word so a rerun gives the same answer.
passed as (
  select
    c.ord, c.name, s.d, s.word, s.df,
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
    -- Sieve 5: where in the headline the word sits. A hard cut like sieve 1 and
    -- 2, not one of sieve 4's rescues — trailing is a reason to drop a word, and
    -- never a reason to keep one that failed something else.
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
    -- Sieve 6, as a cut inside the harness's own copy. Unlike keyword_graph this
    -- is a single pass rather than a fixed point: the harness ranks a fixed
    -- candidate list, so there is no promotion to destabilise. Where the two
    -- disagree, keyword_graph is right and 30_word_scores.sql's `chk` says so.
    and (
      not c.place_gate
      or ov.mode is distinct from 'place'
      or exists (
        select 1 from analysis.day_edges de
        where de.d = s.d and de.npmi >= 0.3
          and ((de.a = s.word and de.b_is_place_false)
            or (de.b = s.word and de.a_is_place_false))
      )
    )
),

-- The render cap is now a column rather than the literal that used to sit
-- here, so a configuration can ask "how many words" the same way it already
-- asks "which words" — see 24_cap_and_place_configs.sql.
shown as (
  select p.*
  from passed p
  join analysis.sieve_configs c on c.ord = p.ord
  where p.rank <= c.render_cap
),

-- Recall denominator: every labelled-good word the day could plausibly have
-- shown. Held at df >= 3 rather than at each configuration's own min_headlines,
-- so the denominator stays fixed and the configurations stay comparable.
pool as (
  select s.d, count(*)::int as good_pool
  from sig s
  join analysis.word_labels l on l.word = s.word
  where l.label = 'good' and s.df >= 3
  group by s.d
),

metrics as (
  select
    sh.ord, sh.name, sh.d, ed.top_story,
    count(*)::int                                  as shown,
    count(*) filter (where l.label = 'good')::int  as good,
    count(*) filter (where l.label = 'bad')::int   as bad,
    count(*) filter (where l.label is null)::int   as unlabeled,
    -- The day's biggest story. A configuration that drops it is rejected no
    -- matter what its precision says — see README.md, rule 5.
    --
    -- The word is per day and not a constant: 폭염 leads three of the four days
    -- and 김민석 leads 2026-08-02, where 폭염 is third. Hardcoding one word was
    -- right while the harness measured two days and would quietly excuse a
    -- configuration that dropped 08-02's real story.
    max(sh.rank) filter (where sh.word = ed.top_story) as top_story_rank
  from shown sh
  left join analysis.word_labels l on l.word = sh.word
  join analysis.eval_days ed on ed.d = sh.d
  group by sh.ord, sh.name, sh.d, ed.top_story
)

select
  m.name,
  m.d::text                                                          as day,
  m.shown,
  m.unlabeled                                                        as unlab,
  m.good,
  m.bad,
  round(100.0 * m.good / nullif(m.good + m.bad, 0), 1)               as prec_pct,
  round(100.0 * m.good / nullif(p.good_pool, 0), 1)                  as recall_pct,
  -- 2g / (2g + b + (G - g)) — the algebraic form of 2PR/(P+R).
  round(200.0 * m.good / nullif(2 * m.good + m.bad + (p.good_pool - m.good), 0), 1) as f1_pct,
  m.top_story                                                        as story,
  coalesce(m.top_story_rank::text, 'DROPPED')                        as story_rank
from metrics m
join pool p on p.d = m.d
order by m.ord, m.d;
