-- 0033: keyword_graph_cache heals itself instead of alerting into a field
-- nobody reads.
--
-- ## The problem
--
-- refresh_keyword_graph_cache's failure is deliberately swallowed by the
-- collector (0032) so a database hiccup on the cache tail can never fail a
-- collection run -- correct, but it leaves that date's cache stale or
-- missing with no further consequence: the only signal was the `graphCache`
-- field in the run's JSON response body, and nobody reads that. CLAUDE.md
-- already records the same shape once -- `cron.job_run_details` says
-- `succeeded` for runs that stored nothing, so a status nobody checks is not
-- a health signal. Once a date's cache is stale, every visitor pays the
-- ~2s recompute again, and concurrent visitors get 500s again (`anon`'s
-- statement_timeout is 3s -- see 0032's header for the original measurement).
--
--
-- ## What this adds
--
-- 1. `keyword_graph_cache_health` -- one row per collected date, `state` one
--    of 'missing' / 'stale' / 'current', derived entirely from row
--    timestamps already in the schema. No new bookkeeping column:
--      - `cells`: how many of that date's cache rows exist, against the
--        full set read from `categories` (all-categories row plus one per
--        slug) rather than a hardcoded 7 -- so the view stays right if a
--        category is ever added or removed.
--      - `computed_at`: the OLDEST computed_at among that date's cells --
--        a partially refreshed date is only as fresh as its stalest cell.
--      - `newest_row`: max(created_at) over that date's headlines.
--      - `state`: 'missing' while cells is short of the full set, 'stale'
--        when newest_row postdates computed_at, else 'current'.
--
--    **What this view cannot see, stated here so it is not rediscovered as
--    a bug:** a `scoring_weights` or `word_overrides` retune also
--    invalidates every cache row it touches, and this view has no way to
--    know -- staleness here is derived purely from headline and cache row
--    timestamps, and a retune moves neither. `computed_at` is exposed
--    precisely so an operator can compare it by eye against when they made
--    the change. docs/DEPLOYMENT.md still says a retune needs a manual
--    `refresh_keyword_graph_cache` call, and this view does not change that.
--
-- 2. `refresh_stale_keyword_graph_cache(p_today date, p_extra int default 1)`
--    -- refreshes p_today unconditionally (today's date reads 'missing' the
--    moment a run starts, same reason 0032's collector call always fills
--    it), then up to p_extra more dates the health view calls 'stale' or
--    'missing', newest first, since recent days are what readers actually
--    look at. Returns the dates it actually refreshed as `setof date` so
--    the collector can report them.
--
--    **Why bounded rather than "refresh everything stale":** one date is 7
--    cells at roughly 2s each on a thick day, so ~14s. Today plus one extra
--    is ~28s -- inside the ~14s the collector's tail already budgets for a
--    single date (0032's header), so doubling it is survivable. Today plus
--    an unbounded backlog is not: a week of missed refreshes would turn one
--    run's tail into minutes. At 6 runs a day and 1 extra healed per run, a
--    backlog of 8 days clears in under 2 days on its own (up to 6 extra
--    dates healed per day, never more than what is actually stale) -- an
--    ordinary gap needs no operator to notice or run anything by hand.
--
--    security definer for the same reason refresh_keyword_graph_cache
--    (0032) and refresh_word_directory (0030) are: it writes to a table
--    under RLS, this migration runs as the owner, and the Edge Function
--    already connects as service_role -- there is no anon view of the
--    tables being handed out, so this is not the keyword_graph-chain
--    security-invoker hazard CLAUDE.md warns about. Execute is
--    service_role only: over PostgREST, anon access would let anyone queue
--    an unbounded ~28s write.
--
--
-- ## Collector
--
-- index.ts calls refresh_stale_keyword_graph_cache(collectedDate, 1) in
-- place of refresh_keyword_graph_cache(collectedDate), same
-- swallow-the-failure-but-report-it shape as 0032 and the word_directory
-- refresh beside it, and the `graphCache` field now names which dates came
-- back so a healed backlog date is visible in the run's own summary.

create view public.keyword_graph_cache_health
with (security_invoker = on) as
with expected as (
  select count(*)::int + 1 as full_cells from public.categories
),
per_date as (
  select collected_date, max(created_at) as newest_row
  from public.headlines
  group by collected_date
)
select
  d.collected_date,
  count(c.category_key)::int as cells,
  min(c.computed_at) as computed_at,
  d.newest_row,
  case
    when count(c.category_key) < e.full_cells then 'missing'
    when d.newest_row > min(c.computed_at) then 'stale'
    else 'current'
  end as state
from per_date d
cross join expected e
left join public.keyword_graph_cache c on c.collected_date = d.collected_date
group by d.collected_date, d.newest_row, e.full_cells
order by d.collected_date desc;

comment on view public.keyword_graph_cache_health is
  'One row per collected date: how many of the (categories + 1) cache cells exist, '
  'the oldest computed_at among them, the newest headlines.created_at for that date, '
  'and a derived state (missing / stale / current). Does NOT detect a scoring_weights '
  'or word_overrides retune -- that invalidates cache rows without moving any row '
  'timestamp this view reads. computed_at is exposed so a retune can be compared '
  'against it by eye; see docs/DEPLOYMENT.md.';

grant select on public.keyword_graph_cache_health to anon, authenticated;

-- security definer for the same reason refresh_keyword_graph_cache (0032) is --
-- see the header above. It only ever calls refresh_keyword_graph_cache, which
-- does the actual writing; this function's own job is picking which dates.
create function public.refresh_stale_keyword_graph_cache(p_today date, p_extra int default 1)
returns setof date
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date;
begin
  perform public.refresh_keyword_graph_cache(p_today);
  return next p_today;

  for d in
    select h.collected_date
    from public.keyword_graph_cache_health h
    where h.state in ('missing', 'stale')
      and h.collected_date <> p_today
    order by h.collected_date desc
    limit p_extra
  loop
    perform public.refresh_keyword_graph_cache(d);
    return next d;
  end loop;

  return;
end;
$$;

comment on function public.refresh_stale_keyword_graph_cache(date, int) is
  'Refreshes p_today unconditionally, then up to p_extra of the dates '
  'keyword_graph_cache_health calls missing/stale, newest first. Called by the '
  'collector as refresh_stale_keyword_graph_cache(collectedDate, 1) at the end of '
  'every run, so a failed refresh self-heals within a bounded number of later runs '
  'instead of sitting in a graphCache field nobody reads. security definer, execute '
  'granted to service_role only -- see 0032 and 0030 for why that is not the '
  'keyword_graph-chain hazard CLAUDE.md warns about.';

revoke all on function public.refresh_stale_keyword_graph_cache(date, int) from public, anon, authenticated;
grant execute on function public.refresh_stale_keyword_graph_cache(date, int) to service_role;
