-- 0030: a directory of every word the analyser has ever produced, so a word
-- that is not on the canvas can still be found.
--
-- **Why this is materialised rather than a view or a plain index.** Search means
-- a substring match, and `word like '%…%'` uses no index at any anchoring. On
-- 2026-08-07, measured on the live database as the second of two runs:
--
--   archive-wide  `word like '김%'`  ->  316 ms, seq scan of all 114,457 rows
--   the same, restricted to one day ->   20 ms, the same seq scan
--   building this directory inline  ->  311 ms (~300 to build, ~1 to filter)
--   this directory, `word ilike '%민석%'`, second of two runs -> 34.8 ms
--
-- Restricting by date does not help, because the seq scan is the fixed cost and
-- only the join to `headlines` shrinks. The important part is how each grows:
-- searching `headline_nouns` grows with **headline volume** (~1.3M rows at 90
-- days), while this grows with **vocabulary**, which grows far more slowly — a
-- new day is mostly words already here. 19,767 rows at eight days.
--
-- No index beyond the unique one below. Filtering 19,767 short strings is the
-- ~1 ms above, and a substring match could not use a btree index anyway.
--
-- `last_date` is shown on every search result and breaks ties in the ordering.
-- It deliberately does not outrank `total`: a recency-weighted score would be a
-- ranking invented here with nothing to measure it against, and the trajectory
-- answers the recency question properly one click later.

create materialized view public.word_directory as
select
  n.word,
  count(*)::int as total,
  count(distinct h.collected_date)::int as days,
  max(h.collected_date) as last_date
from public.headline_nouns n
join public.headlines h on h.id = n.headline_id
group by n.word;

-- `refresh materialized view concurrently` requires a unique index, and
-- concurrently is what keeps the directory readable while the collector is
-- rebuilding it. Without it a search issued during a refresh would block.
create unique index word_directory_word_idx on public.word_directory (word);

-- **A materialised view cannot carry an RLS policy**, so unlike every table in
-- this schema its access model is the grant and nothing else. Supabase's
-- default grants are wide, so they are revoked explicitly first rather than
-- assumed away.
revoke all on public.word_directory from public, anon, authenticated;
grant select on public.word_directory to anon, authenticated;

comment on materialized view public.word_directory is
  'One row per word ever analysed, for substring search. Refreshed by the '
  'collector at the end of every run via refresh_word_directory(). Has no RLS — '
  'a matview cannot carry a policy — so the select-only grant is the whole of '
  'its access model.';

-- **security definer, and this is not the case CLAUDE.md forbids.** `refresh
-- materialized view` is owner-only; this migration runs as the owner and the
-- Edge Function connects as `service_role`. What that rule protects is the
-- `keyword_graph` chain, where a definer would hand out the service role's view
-- of the tables to `anon`. This function reads nothing and returns nothing.
--
-- `set search_path = ''` all the same, which is why every name inside is
-- schema-qualified. Execute is granted to `service_role` alone: to `anon` it
-- would let anyone queue unbounded ~300 ms refreshes through PostgREST.
create or replace function public.refresh_word_directory()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently public.word_directory;
end;
$$;

revoke all on function public.refresh_word_directory() from public, anon, authenticated;
grant execute on function public.refresh_word_directory() to service_role;
