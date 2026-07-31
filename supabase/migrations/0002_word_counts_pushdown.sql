-- daily_word_counts was defined with `group by grouping sets`, which blocks
-- predicate pushdown: EXPLAIN ANALYZE on the deployed database showed the
-- planner aggregating every row ever collected and only then applying the
-- collected_date filter ("Rows Removed by Filter: 3547"), with
-- headlines_collected_date_idx unused. That cost is proportional to total
-- history rather than to the day being viewed, so at 900 headlines/day it
-- degrades on every page load as the archive grows.
--
-- The same result set as a UNION ALL of two plain aggregates lets the planner
-- push collected_date into each branch, and lets it discard the branch that
-- cannot satisfy the category_slug predicate ("One-Time Filter: false").
-- Verified equivalent against the grouping-sets version on live data: 6031
-- rows from each, zero rows in either direction of EXCEPT.

drop view daily_word_counts;

create view daily_word_counts with (security_invoker = on) as
-- Per-category counts.
select
  h.collected_date,
  c.slug as category_slug,
  n.word,
  count(*)::int as count
from headline_nouns n
join headlines h on h.id = n.headline_id
join categories c on c.id = h.category_id
group by h.collected_date, c.slug, n.word
union all
-- All-categories rollup, keyed by a null slug. No join to categories: the
-- rollup does not read the slug, and dropping it removes a join from the
-- branch the front page hits first.
select
  h.collected_date,
  null::text as category_slug,
  n.word,
  count(*)::int as count
from headline_nouns n
join headlines h on h.id = n.headline_id
group by h.collected_date, n.word;

grant select on daily_word_counts to anon, authenticated;
