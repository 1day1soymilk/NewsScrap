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

-- The α values in play, not the configurations. keyword_signals costs ~950ms a
-- day and α is a parameter on it (migration 0025), so putting the column
-- straight into passed0's lateral would evaluate it once per (day,
-- configuration) — ten calls a day where five distinct α values are being
-- asked about. Every signal except df_balanced is α-independent, so the
-- configurations join onto this instead and each α is paid for once.
alphas as (
  select distinct balance_alpha as a from analysis.sieve_configs where active
),

sig as (
  select p.d, a.a as balance_alpha, s.*
  from params p
  cross join alphas a
  cross join lateral keyword_signals(p.d, a.a) s
),

-- Selection is by frequency, and `demote_head_pos` is the one thing that has
-- ever been allowed to disturb that — it is what round six is asking about, so
-- it is a knob here rather than a change. With it at its default (9.9) this
-- expression is exactly `order by s.df desc, s.word` and every earlier round's
-- numbers reproduce. Ties break on the word so a rerun gives the same answer.
--
-- Round fourteen adds `df_balanced` ahead of `df`, matching
-- keyword_graph_rank's `count_balanced desc, count desc, word` exactly. At
-- α = 0 every balance factor is numeric 1, so df_balanced *is* df and the two
-- keys are the same key twice — which is why configurations 200-211 reproduce
-- their pre-α numbers to the digit rather than merely closely. Note the
-- harness compares df_balanced (day-wide) where the RPC compares
-- count_balanced (scoped); on the all-categories view this file measures, the
-- scope is the whole day and the two are the same number.
--
-- Sieve 6 is deliberately not applied here. It judges a place against the set
-- that is actually drawn, and "drawn" cannot be known until sieves 1-5 have
-- already produced a ranking against the render cap — that is what drawn0 and
-- gate_fail below are for. passed0 carries head_pos, demote_head_pos,
-- render_cap and place_gate through so the later CTEs, and the final re-rank,
-- do not have to rejoin sieve_configs or keyword_signals.
passed0 as (
  select
    c.ord, c.name, s.d, s.word, s.df, s.df_balanced, s.head_pos,
    c.demote_head_pos, c.render_cap, c.place_gate,
    row_number() over (partition by c.ord, s.d
      -- 강등: 제목 뒤에 앉는 단어를 자르지 않고 상한 아래로 밀어낸다.
      -- 자르면 카테고리 탭에서 24셀 중 8셀을 지고 한 셀도 못 이긴다 —
      -- 탭에는 상한이 걸리지 않아 잘린 자리를 메울 단어가 없기 때문이다.
      order by (s.head_pos > c.demote_head_pos) asc,
               s.df_balanced desc, s.df desc, s.word) as rank0
  from analysis.sieve_configs c
  -- The α slice this configuration asked for, rather than a cross join: sig
  -- holds one row per (day, α, word) and a configuration reads exactly one α.
  join sig s on s.balance_alpha = c.balance_alpha
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
),

-- The set sieve 6 judges places against: rank <= render_cap *without* the
-- gate. keyword_graph faces the same circularity — the gate changes the drawn
-- set, and "drawn" is exactly what the gate reads — and resolves it by
-- iterating to a fixed point. The harness ranks one fixed candidate list, so a
-- single pass stands in for the loop: this is that pass's reference set, not
-- its output. A word promoted into a gap a dropped place leaves is not itself
-- re-checked against drawn0.
drawn0 as (
  select p0.* from passed0 p0 where p0.rank0 <= p0.render_cap
),

-- Sieve 6, as a cut inside the harness's own copy. A place in drawn0 survives
-- only if it holds a line — cooc and npmi already filtered into
-- analysis.day_edges, npmi checked here — to a partner that is *also* in
-- drawn0 and is not itself a place. Testing against day_edges alone (any
-- co-occurring non-place word, drawn or not) was this file's bug: 부산 on
-- 2026-08-02 survived through 경기, a word that clears no sieve-4 clause and
-- was never itself on screen. Migration 0024's header is explicit that "has an
-- edge" means "has a line on screen" — the partner has to be a member of the
-- same drawn set the place is being judged against, not merely a word that
-- shares a headline with it somewhere in the day's data.
--
-- This is a second copy of sieve 6 and it can drift the way every second copy
-- here can. `30_word_scores.sql`'s `chk` does not cover it — `is_place` is
-- deliberately absent from keyword_graph's JSON (see migration 0024's tail
-- comment), so that file cannot see a place-gate disagreement at all. What
-- actually checks this copy: flip `scoring_weights.place_needs_edge` to 1,
-- diff keyword_graph(d, null)'s node words against config 210's drawn set
-- (the CTEs above, unmodified) on every day in analysis.eval_days, then flip
-- it back to 0. Task 3's report records the result — 0 words different in
-- either direction, all four days — and any later change to this clause
-- should re-run that comparison rather than trust this comment on its own.
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
-- the same order passed0 used. Removing rows before row_number() runs is what
-- lets the cap refill from whatever ranked next, exactly as it already did
-- before sieve 6 existed — the mechanism is unchanged, only what feeds it.
-- When place_gate is false, gate_fail is empty by construction (its own WHERE
-- requires d0.place_gate), so passed is byte-identical to passed0 and every
-- non-gated configuration's numbers are unaffected by any of this.
passed as (
  select
    p0.ord, p0.name, p0.d, p0.word, p0.df,
    row_number() over (partition by p0.ord, p0.d
      order by (p0.head_pos > p0.demote_head_pos) asc,
               p0.df_balanced desc, p0.df desc, p0.word) as rank
  from passed0 p0
  where not exists (
    select 1 from gate_fail gf
    where gf.ord = p0.ord and gf.d = p0.d and gf.word = p0.word
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
--
-- α must not reach it either, and does not: this reads `df` and the word, both
-- of which are α-independent — the exponent only ever produces `df_balanced`,
-- a second column beside `df` rather than a replacement for it. So the plain
-- one-argument call is right here whatever scoring_weights holds.
--
-- **It deliberately does not read `sig`, and that is a plan decision rather
-- than a stylistic one.** Reading a single α slice out of sig is the same four
-- numbers and was written that way first; it also gives sig a second consumer,
-- which forces the CTE to materialise, and neither analysis.eval_days nor a
-- set-returning function carries row statistics — the planner estimated sig at
-- 5,080,000 rows (4 days read as 1,270, keyword_signals as its 1,000-row
-- default, times the α list), collapsed every filter above it to 1, and joined
-- pool to metrics with an unmaterialised nested loop that re-ran the whole
-- aggregate per metrics row. 24s became a statement timeout at 120s. Same
-- class of failure 24_cap_and_place_configs.sql's header records, and the same
-- cause: a CTE the planner has no counts for. The cost of the fix is four
-- extra keyword_signals calls a run, one per day, which is what the α sweep
-- pays to keep the recall denominator fixed.
pool as (
  select p.d, count(*)::int as good_pool
  from params p
  cross join lateral keyword_signals(p.d) s
  join analysis.word_labels l on l.word = s.word
  where l.label = 'good' and s.df >= 3
  group by p.d
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
