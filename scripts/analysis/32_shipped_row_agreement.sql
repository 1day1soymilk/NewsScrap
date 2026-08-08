-- scripts/analysis/32_shipped_row_agreement.sql
--
-- Does the harness's **shipped configuration row** still say what
-- `scoring_weights` says? One row per threshold; `chk` is `!` on disagreement.
--
--   scripts/analysis/run.sh scripts/analysis/32_shipped_row_agreement.sql
--
-- ## Why this exists
--
-- Migration `0028` turned the place gate on and left `analysis.sieve_configs`'
-- shipped row carrying `place_gate false`, so for a release cycle **the harness
-- scored a screen the app does not draw** and nothing said so. Round fifteen
-- found it by reading the migration rather than by running anything, and wrote
-- the habit down: *a migration that changes `scoring_weights` has to change the
-- harness's shipped row in the same breath.* A habit that depends on someone
-- remembering is not a check. This is the check.
--
-- Run it after any migration touching `scoring_weights`, and after narrowing
-- `active` at the end of a round.
--
-- ## What it deliberately does not do
--
-- It compares **configuration**, not drawn words. Comparing words would mean
-- putting a second copy of the harness's sieve chain in this file, and a second
-- copy of a rule is this directory's most expensive recurring mistake —
-- `30_word_scores.sql`'s sieve 4d drifted for four rounds, and
-- `11_category_eval.sql`'s ranking disagreed with the RPC until round thirteen.
-- `0028`'s failure was a flag on one side and not the other, which is exactly
-- what this catches and catches cheaply.
--
-- **The word-level comparison was run once, by hand, and it found something this
-- file cannot see.** On 2026-08-03 the harness draws 강원 where the deployed
-- function draws 데이터센터 — the harness's single-pass sieve 6 meeting the
-- deployed fixed point (migration `0024`). `10_sieve_eval.sql`'s `drawn0`
-- comment predicts it exactly: *"a word promoted into a gap a dropped place
-- leaves is not itself re-checked."* 강원 is outside the gate-off top 70, rises
-- into it once other places are banned, and is never judged again.
--
-- **Round sixteen's α surfaced that; it did not cause it.** Measured by setting
-- `category_balance_alpha_min_spread` to 99, which makes the deployed sieve
-- α-free, and comparing the pre-α shipped row: **0 differences on all seven
-- days.** The approximation was always there; it had never put a place just
-- below the cap before. It is left as an approximation because the cost is one
-- word of seventy on one day of seven — about 0.1 F1 — and cannot flip a
-- comparison, since every configuration in the harness shares the same single
-- pass. If it ever grows past that one cell, write the second pass.

with
-- The row under test: whichever configuration is active. A round narrows
-- `active` to its shipped row at the end (27_round_sixteen_configs.sql's tail),
-- so after that this is unambiguous. More than one active row means the round is
-- still open and the `expected` column below is the only meaningful half.
shipped as (
  select * from analysis.sieve_configs where active
),

w as (
  select
    max(value) filter (where key = 'min_headlines')                     as min_headlines,
    max(value) filter (where key = 'min_standalone')                    as min_standalone,
    max(value) filter (where key = 'min_word_len')                      as min_word_len,
    max(value) filter (where key = 'min_spec')                          as min_spec,
    max(value) filter (where key = 'max_neighbors_per_doc')             as max_npd,
    max(value) filter (where key = 'min_proper')                        as min_proper,
    max(value) filter (where key = 'demote_head_pos')                   as demote_head_pos,
    max(value) filter (where key = 'render_cap')                        as render_cap,
    max(value) filter (where key = 'place_needs_edge')                  as place_needs_edge,
    max(value) filter (where key = 'category_balance_alpha')            as balance_alpha,
    max(value) filter (where key = 'category_balance_alpha_min_spread') as alpha_min_spread
  from scoring_weights
),

-- One row per threshold rather than one wide row, so a disagreement names
-- itself.
--
-- **Both sides are rendered to text here, and the numerics go through
-- `trim_scale` first.** `numeric` carries its scale, so 0.50 and .5 are equal
-- as numbers and different as strings — a check that reported that as a
-- disagreement would be noise, and one that ignored it by comparing loosely
-- would miss a real one. Normalising first lets a single text comparison serve
-- both the numeric knobs and `place_gate`, which is a boolean on the harness
-- side and a 0/1 numeric in `scoring_weights`.
pairs (ord, knob, harness, deployed) as (
  select s.ord, 'min_headlines',   trim_scale(s.min_headlines)::text,   trim_scale(w.min_headlines)::text   from shipped s cross join w
  union all select s.ord, 'min_standalone',  trim_scale(s.min_standalone)::text,  trim_scale(w.min_standalone)::text  from shipped s cross join w
  union all select s.ord, 'min_word_len',    trim_scale(s.min_word_len)::text,    trim_scale(w.min_word_len)::text    from shipped s cross join w
  union all select s.ord, 'min_spec',        trim_scale(s.min_spec)::text,        trim_scale(w.min_spec)::text        from shipped s cross join w
  union all select s.ord, 'max_npd',         trim_scale(s.max_npd)::text,         trim_scale(w.max_npd)::text         from shipped s cross join w
  union all select s.ord, 'min_proper',      trim_scale(s.min_proper)::text,      trim_scale(w.min_proper)::text      from shipped s cross join w
  union all select s.ord, 'demote_head_pos', trim_scale(s.demote_head_pos)::text, trim_scale(w.demote_head_pos)::text from shipped s cross join w
  union all select s.ord, 'render_cap',      trim_scale(s.render_cap)::text,      trim_scale(w.render_cap)::text      from shipped s cross join w
  -- place_gate is the one 0028 got wrong, and the one whose types differ.
  union all select s.ord, 'place_gate',      s.place_gate::text,
                   (w.place_needs_edge >= 1)::text                                              from shipped s cross join w
  union all select s.ord, 'balance_alpha',   trim_scale(s.balance_alpha)::text,   trim_scale(w.balance_alpha)::text   from shipped s cross join w
  -- A null threshold on either side means "no gate", so null and absent agree.
  union all select s.ord, 'alpha_min_spread',
                   coalesce(trim_scale(s.alpha_min_spread)::text, '(none)'),
                   coalesce(trim_scale(w.alpha_min_spread)::text, '(none)')                     from shipped s cross join w
)

select
  p.ord,
  (select name from shipped s where s.ord = p.ord) as config,
  p.knob,
  p.harness,
  p.deployed,
  case when p.harness is not distinct from p.deployed then '' else '!' end as chk
from pairs p
order by p.ord, (case when p.harness is not distinct from p.deployed then 1 else 0 end), p.knob;
