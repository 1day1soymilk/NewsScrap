-- 0035_gated_category_balance.sql
--
-- Turns the category-balance exponent α **on**, and only on days whose sections
-- actually collected unequally.
--
-- ## What round sixteen measured
--
-- `df_balanced(α) = Σ_c df_c × (N̄ / N_c)^α` has been in the schema since 0025
-- and switched off since 0026. Round fourteen could not price it; round fifteen
-- priced it flat and it lost at every setting; round sixteen priced it **gated**
-- on the day's own imbalance and it wins:
--
--   configuration                    07-31  08-01  08-02  08-03  08-04  08-05  08-06   meanF1  meanP
--   300 SHIPPED before α              67.3   64.3   77.1   42.0   26.8   38.0   35.6    50.16  86.49
--   313 flat α 1.00                   64.3   64.3   77.1   42.7   26.8   39.2   36.2    50.09  86.69
--   320 α 1.00, spread >= 1.2         67.3   64.3   77.1   42.7   26.8   39.2   36.2    50.51  87.30
--   spread                            1.01   2.52   1.67   1.49   2.44   2.48   2.21
--
-- **The reason to ship it is not the mean.** Two of those days were added in the
-- same round and both are imbalanced, so a seven-day mean flatters any mechanism
-- that helps on imbalanced days. What decides it is that **320 loses no day at
-- all** — three better, four identical — while flat α pays 3.0 points on the
-- balanced day for the same gains. Weak dominance is a different kind of fact
-- from a better average, and it is what round fifteen's +0.26 arithmetic lacked.
-- `story_rank` is 1 on all 63 rows, so rule 5 is clear.
--
-- ## Why a gate rather than a smaller α
--
-- The sweep says the gate is a guard against a degenerate input, not a dosage.
-- Thresholds of 1.6 and 2.0 both score 50.41 against 1.2's 50.51, because they
-- take 2026-08-03 (spread 1.49) out of α and α is worth +0.7 there; anything at or below 1.01 is
-- flat α, which is worse again. So the optimum is **any value in (1.01, 1.49]**
-- and both directions are worse — an interior optimum in the sense rule 2 asks
-- for. Every day with any real imbalance wants α. The only day it damages is the
-- one whose six sections collected 150/149/150/150/150/150 in a single capped
-- run, where the factors span 0.6% and α does nothing but perturb a `df` tie in
-- the third decimal, at a cost of three good words.
--
-- **1.2 is a plateau midpoint and must not be retuned**, the same way
-- `min_standalone` sits at 0.10 because .05 through .30 are identical. Moving it
-- inside the plateau changes nothing; moving it outside is the measurement above.
--
-- ## Where the gate lives, and why it is not a second copy of anything
--
-- α was already resolved in exactly one place — `category_balance_factors`'
-- `alpha` CTE — with `keyword_signals` passing `p_alpha` straight through. The
-- gate goes there, so the number of places that decide "what α is in force" stays
-- one.
--
-- **The gate applies to the default path only.** An explicit `p_alpha` is
-- honoured verbatim, because that argument means "evaluate at this α" and the
-- sieve harness depends on it: `10_sieve_eval.sql` and `20_unlabeled.sql` build
-- one `keyword_signals(d, α)` slice per distinct α and pick between slices
-- themselves, via `analysis.sieve_configs.alpha_min_spread`. Gating an explicit
-- argument would make a requested slice silently a different slice.
--
-- The spread itself gets its own function rather than being computed inline
-- twice, since the harness needs the same number to choose its slice. One
-- definition, two readers — the rule this repository applies to `keyword_signals`
-- and to `word_directory` alike.
--
-- ## Cache
--
-- `keyword_graph_config_fingerprint()` hashes every `scoring_weights` row minus
-- `note`, so both the changed value and the new key are covered with no edit
-- there — that is the denylist inversion 0034 exists for. Every cached cell goes
-- stale on the next read, `keyword_graph` recomputes rather than serving a
-- mismatched fingerprint, and `refresh_stale_keyword_graph_cache` heals the rows
-- within a run or two. No operator step.

-- --------------------------------------------------------------------------
-- The day's imbalance, in one place.
--
-- max/min over the day's per-section headline counts. This is the raw ratio —
-- the same number as max/min over `category_balance_factors(d, 1)`, since every
-- factor is N̄/N_c and N̄ cancels — and it is deliberately independent of the
-- shipped α, because a *threshold on imbalance* measured through the exponent it
-- gates would read 1.0 for every day whenever α is 0 and could never turn itself
-- on. That trap is real: `category_balance_factors(d)` with no argument returns
-- all-1.0 today for exactly that reason.
--
-- A day with one section is spread 1 by construction, and a day with a section
-- that collected nothing is absent from the grouping rather than a division by
-- zero — the same reading `category_balance_factors` takes of N̄.
-- --------------------------------------------------------------------------
create or replace function public.category_balance_spread(p_date date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(max(t.n) / nullif(min(t.n), 0), 1)
  from (
    select count(*)::numeric as n
    from public.headlines h
    join public.categories c on c.id = h.category_id
    where h.collected_date = p_date
    group by c.slug
  ) t;
$fn$;

grant execute on function public.category_balance_spread(date) to anon, authenticated;

-- --------------------------------------------------------------------------
-- The gate, inside the one place α is resolved.
--
-- Unchanged from 0029 except for the `alpha` CTE. `cat_totals`, `cat_mean` and
-- the final select are byte-identical, and `power(x, 0)` is exactly 1 in numeric
-- — which is what makes a gated-off day the identity rather than something that
-- rounds to it.
-- --------------------------------------------------------------------------
create or replace function public.category_balance_factors(
  p_date date,
  p_alpha numeric default null
)
returns table (category_slug text, factor numeric)
language sql
stable
security invoker
set search_path = ''
as $fn$
with alpha as (
  select case
    -- An explicit argument means "evaluate at this α" and is never gated. The
    -- harness relies on this to build one slice per α and choose between them.
    when p_alpha is not null then p_alpha
    -- The default path: the shipped α, but only on a day imbalanced enough to
    -- have anything to correct. A null threshold means "no gate", which is what
    -- every deployment before this migration did.
    when public.category_balance_spread(p_date) >= coalesce(
           (select sw.value from public.scoring_weights sw
             where sw.key = 'category_balance_alpha_min_spread'),
           0)
      then coalesce(
           (select sw.value from public.scoring_weights sw
             where sw.key = 'category_balance_alpha'),
           0)
    else 0
  end as a
),
cat_totals as (
  select c.slug, count(*)::numeric as n
  from public.headlines h
  join public.categories c on c.id = h.category_id
  where h.collected_date = p_date
  group by c.slug
),
cat_mean as (select avg(ct.n) as nbar from cat_totals ct)
select ct.slug, power(cm.nbar / ct.n, al.a)::numeric
from cat_totals ct
cross join cat_mean cm
cross join alpha al;
$fn$;

grant execute on function public.category_balance_factors(date, numeric) to anon, authenticated;

-- --------------------------------------------------------------------------
-- The values.
-- --------------------------------------------------------------------------
update public.scoring_weights
set value = 1.00,
    note  = 'sieve ranking: 0 = raw frequency (identity), 1 = the count under '
         || 'equal collection. ON since 0035, and gated by '
         || 'category_balance_alpha_min_spread rather than applied flat. Round '
         || 'fifteen measured it flat and it lost at every setting; round '
         || 'sixteen measured it gated on seven days and it loses no day at all '
         || '(three better, four identical; mean F1 50.16 -> 50.51, precision '
         || '86.49 -> 87.30) and strictly dominates flat alpha, which pays 3.0 '
         || 'points on the balanced day for the same gains. Weak dominance is '
         || 'the reason, not the mean — two of those seven days were added in '
         || 'the same round and both are imbalanced.'
where key = 'category_balance_alpha';

insert into public.scoring_weights (key, value, note) values (
  'category_balance_alpha_min_spread', 1.2,
  'the day imbalance below which category_balance_alpha is not applied, read as '
  || 'category_balance_spread(d) = max/min of the day''s per-section headline '
  || 'counts. A PLATEAU MIDPOINT, NOT A TUNED NUMBER: the seven eval days sit at '
  || '1.01 / 2.52 / 1.67 / 1.49 / 2.44 / 2.48 / 2.21, so any value in '
  || '(1.01, 1.49] splits them identically. Both directions are worse — 1.6 and '
  || '2.0 score below it because they take 2026-08-03 (spread 1.49) out of alpha '
  || 'and alpha is worth +0.7 there, and anything at or below 1.01 is flat '
  || 'alpha. So this is a guard against a degenerate input (the day that '
  || 'collected 150/149/150/150/150/150 and has nothing to correct), not a '
  || 'dosage. Do not retune inside the plateau; re-measure with '
  || 'scripts/analysis/27_round_sixteen_configs.sql if the day set changes.'
)
on conflict (key) do update set value = excluded.value, note = excluded.note;
