# Place gating, balanced ranking, wider canvas, scattered words — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep place names off the canvas unless a line joins them to a word that is not a place; rank words as if every section had been collected to the same depth; widen the canvas and raise the 70-word cap; and scatter the edgeless words through the drawing instead of banding them at the bottom.

**Architecture:** Two rounds. Round 1 changes the database — a fourth `word_overrides` mode, a `df_balanced` signal in `keyword_signals`, a fixed-point node selection in `keyword_graph`, and the harness rows that price all three. Round 2 changes the canvas — a scatter pass in `graphLayout.ts` that treats routed edge curves as obstacles, a wider graph container, and a donut of the real per-section proportions. Round 2 cannot start until Round 1's fixture is re-pulled, because the sieve decides which words and therefore which edges exist.

**Tech Stack:** Postgres (Supabase, no local instance — all SQL goes through the Management API via `scripts/analysis/run.sh`), TypeScript, React 19, Vite, d3-force, Vitest, Playwright, Tailwind v4.

## Global Constraints

- **`npm run build` is the gate**, not `npm test`. Vitest transpiles without type checking, so tests pass on code that does not compile. Run `npm run build` before claiming any task done.
- **No local Postgres, Docker or Deno.** SQL is applied with `scripts/analysis/run.sh <file.sql>` or the Management API. Migrations are applied with `npx supabase db push --password "$SUPABASE_DB_PASSWORD"` after `set -a && . ./.env.supabase && set +a`.
- **Never reimplement a signal formula.** `keyword_signals` is the single copy; `keyword_graph` and `scripts/analysis/` both read it.
- **Never change a threshold without `10_sieve_eval.sql`** (and `11_category_eval.sql` when the question touches a category tab). `scripts/analysis/README.md` holds five rules; rule 4 (`unlabeled` must be 0) and rule 5 (`story_rank` must not read `DROPPED`) reject rows outright.
- **`overlap` in `scripts/layout/measure.ts` must never exceed 0.** Layout verdicts are read from `xIn`/`xBr` split, never from total `crossings`.
- Colours come from `src/index.css`'s `@theme` block and `src/lib/sectionColors.ts`. Components hold `var(--color-*)`, never hex.
- SVG `fill`/`stroke` go through inline `style`; `opacity`/`stroke-opacity` stay attributes (the e2e suite asserts on them).
- Commit after every task. Do not merge to `main` — the repository owner does that.

---

# Round 1 — data and sieve

### Task 1: The `place` mode and its list

**Files:**
- Create: `supabase/migrations/0023_place_dictionary.sql`

**Interfaces:**
- Produces: `word_overrides.mode` accepts `'place'`. No behaviour change — nothing reads the new mode yet.

- [ ] **Step 1: Write the migration**

```sql
-- 0023: a fourth word_overrides mode — 'place'.
--
-- A place name is where a story happened rather than what happened, so on its
-- own it says nothing. On 2026-08-04 the canvas drew 강남, 대구, 전남 and 인천
-- holding no edge at all, and 광주 holding only an edge to 서울.
--
-- **This migration changes no behaviour.** It adds the mode and the list.
-- Migration 0025 is what makes the sieve read them, and only after
-- 10_sieve_eval.sql and 11_category_eval.sql have priced it — the same
-- wired-then-measured shape 0017 and 0018 used for min_proper.
--
-- **Scope: domestic administrative names and broad regions only.** Countries and
-- foreign regions are out — 유럽, 남미, 중동 and 한국 are already `exclude`
-- entries from 0021 and stay that way, because a backdrop word is worth nothing
-- whether or not it holds an edge.
--
-- **경기 is deliberately absent.** 경기도, a match, and 景氣 are one string, so
-- gating it would cut a word that is usually not a place. It is the general case
-- of what this list cannot hold: a place name that is also an ordinary noun.
-- 광주 has the same shape (광주광역시 / 경기도 광주시) and is included because
-- both senses are places.

alter table public.word_overrides drop constraint word_overrides_mode_check;
alter table public.word_overrides add constraint word_overrides_mode_check
  check (mode in ('exclude', 'demote', 'allow', 'place'));

comment on table public.word_overrides is
  'Hand maintained. exclude: never draw. demote: draw faded. allow: exempt from sieve 4. place: draw only when joined to a non-place.';

insert into public.word_overrides (word, mode, note) values
  -- 광역시·도
  ('서울', 'place', 'sido'), ('부산', 'place', 'sido'), ('대구', 'place', 'sido'),
  ('인천', 'place', 'sido'), ('광주', 'place', 'sido'), ('대전', 'place', 'sido'),
  ('울산', 'place', 'sido'), ('세종', 'place', 'sido'), ('강원', 'place', 'sido'),
  ('충북', 'place', 'sido'), ('충남', 'place', 'sido'), ('전북', 'place', 'sido'),
  ('전남', 'place', 'sido'), ('경북', 'place', 'sido'), ('경남', 'place', 'sido'),
  ('제주', 'place', 'sido'), ('경기도', 'place', 'sido — 경기 alone is not a place'),
  -- 권역
  ('호남', 'place', 'region'), ('영남', 'place', 'region'), ('충청', 'place', 'region'),
  ('수도권', 'place', 'region'), ('강남', 'place', 'region'), ('강북', 'place', 'region'),
  -- 시·군·구 seen in this archive
  ('수원', 'place', 'si'), ('성남', 'place', 'si'), ('용인', 'place', 'si'),
  ('고양', 'place', 'si'), ('부천', 'place', 'si'), ('안산', 'place', 'si'),
  ('청주', 'place', 'si'), ('천안', 'place', 'si'), ('전주', 'place', 'si'),
  ('포항', 'place', 'si'), ('창원', 'place', 'si'), ('김해', 'place', 'si'),
  ('구미', 'place', 'si'), ('경주', 'place', 'si'), ('통영', 'place', 'si'),
  ('원주', 'place', 'si'), ('춘천', 'place', 'si'), ('강릉', 'place', 'si'),
  ('여수', 'place', 'si'), ('목포', 'place', 'si'), ('순천', 'place', 'si'),
  ('해남', 'place', 'gun'), ('양산', 'place', 'si — also holds an allow entry from 0003')
on conflict (word) do nothing;
```

- [ ] **Step 2: Apply it**

```bash
cd /c/Users/YNH/Desktop/Programming/NewsScrap
set -a && . ./.env.supabase && set +a
npx supabase db push --password "$SUPABASE_DB_PASSWORD"
```

- [ ] **Step 3: Verify no drawn word moved and see what the list catches**

Run:
```bash
scripts/analysis/run.sh -c "
with g as (select public.keyword_graph('2026-08-04'::date, null) as j)
select n->>'word' as word, (n->>'count')::int as df,
       (select count(*) from json_array_elements((select j->'edges' from g)) e
         where e->>'a' = n->>'word' or e->>'b' = n->>'word') as degree
from g, json_array_elements((select j->'nodes' from g)) n
join public.word_overrides ov on ov.word = n->>'word' and ov.mode = 'place'
order by degree, df desc;"
```
Expected: 70 nodes still returned overall, and this query lists 강남·대구·전남·인천 at degree 0, 광주 at 1, 부산 at 2, 서울·호남 at 3. `on conflict do nothing` means 양산 keeps its `allow` row and does **not** appear — record that in the commit message; it is a real gap the next step must handle.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0023_place_dictionary.sql
git commit -m "Name the places, without yet asking them for a reason to be there"
```

---

### Task 2: The fixed point, wired and off

**Files:**
- Create: `supabase/migrations/0024_place_gating.sql`

**Interfaces:**
- Produces: `public.keyword_graph_nodes(p_date date, p_category text, p_banned text[])` returning `table(word text, count int, spec numeric, standalone numeric, neighbors_per_doc numeric, assoc numeric, passed_by text, category_slug text, is_place boolean, faded boolean, rank bigint)`.
- Produces: `scoring_weights` key `place_needs_edge`, 0 = off.
- Consumes: `keyword_signals(date)` unchanged.

**Why a helper and plpgsql.** The rule is a fixed point: dropping a place promotes the next rank, and the promoted word may have been the only non-place partner of another place. A recursive CTE cannot express it — Postgres forbids window functions in a recursive term, and the ranking is a window function. So `keyword_graph` becomes `plpgsql` and loops. The node query lives in `keyword_graph_nodes` so there is exactly one copy of it, called by both the loop and the final JSON.

Termination is not by a magic number: the banned set only grows and is bounded by the number of places, so the loop ends. The guard at 50 is a backstop, not the mechanism.

- [ ] **Step 1: Write the migration**

Copy the whole `with w as (…) … nodes as (…)` chain out of `0018_enable_proper_noun_rescue.sql` into `keyword_graph_nodes`, adding exactly three things: a `p_banned` filter in `candidates`, `is_place` on the node row, and nothing else. Then:

```sql
create or replace function public.keyword_graph(p_date date, p_category text default null)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  banned  text[] := '{}';
  dropped text[];
  gate    boolean;
  guard   int := 0;
begin
  select coalesce(max(value), 0) = 1 into gate
  from public.scoring_weights where key = 'place_needs_edge';

  if gate then
    loop
      guard := guard + 1;
      -- A place with no edge to a drawn non-place. Edges are the same ones the
      -- JSON below emits, so "has an edge" means "has a line on screen".
      select coalesce(array_agg(n.word), '{}') into dropped
      from public.keyword_graph_nodes(p_date, p_category, banned) n
      where n.is_place
        and not exists (
          select 1
          from public.keyword_graph_edges(p_date, p_category, banned) e
          join public.keyword_graph_nodes(p_date, p_category, banned) m
            on m.word = case when e.a = n.word then e.b else e.a end
          where (e.a = n.word or e.b = n.word) and not m.is_place
        );
      exit when cardinality(dropped) = 0 or guard > 50;
      banned := banned || dropped;
    end loop;
  end if;

  return (
    select json_build_object(
      'nodes', coalesce((select json_agg(json_build_object(
          'word', n.word, 'count', n.count, 'spec', round(n.spec, 3),
          'standalone', round(n.standalone, 3),
          'neighbors_per_doc', round(n.neighbors_per_doc, 3),
          'assoc', round(n.assoc, 3), 'passed_by', n.passed_by,
          'category_slug', n.category_slug, 'faded', n.faded) order by n.rank)
        from public.keyword_graph_nodes(p_date, p_category, banned) n), '[]'::json),
      'edges', coalesce((select json_agg(json_build_object(
          'a', e.a, 'b', e.b, 'cooc', e.cooc, 'npmi', round(e.npmi, 3))
          order by e.npmi desc, e.cooc desc)
        from public.keyword_graph_edges(p_date, p_category, banned) e), '[]'::json)
    )
  );
end;
$fn$;

insert into public.scoring_weights (key, value, note) values
  ('place_needs_edge', 0,
   'sieve 6: DISABLED. 1 draws a word_overrides place only when a line joins it to a non-place. 0 draws every place. Turned on by 0025 after measurement.')
on conflict (key) do update set value = excluded.value, note = excluded.note;

grant execute on function public.keyword_graph_nodes(date, text, text[]) to anon;
grant execute on function public.keyword_graph_edges(date, text, text[]) to anon;
```

`keyword_graph_edges(p_date, p_category, p_banned)` is the existing `edges` CTE lifted the same way, returning `table(a text, b text, cooc int, npmi numeric)`, with its `exists (select 1 from nodes …)` clause pointed at `keyword_graph_nodes(p_date, p_category, p_banned)`.

- [ ] **Step 2: Capture the current output before applying**

```bash
for d in 2026-07-31 2026-08-01 2026-08-02 2026-08-03 2026-08-04; do
  scripts/analysis/run.sh -c "select md5(public.keyword_graph('$d'::date, null)::text) as h" 
done | tee /tmp/graph-hashes-before.txt
```

- [ ] **Step 3: Apply and verify byte-identical output**

```bash
set -a && . ./.env.supabase && set +a
npx supabase db push --password "$SUPABASE_DB_PASSWORD"
```
Then re-run the hash loop. Expected: all five hashes identical to `/tmp/graph-hashes-before.txt`. **The gate is off, so a single changed hash means the refactor moved something and must be fixed before going on.** Repeat for one category tab (`'politics'`) as well.

- [ ] **Step 4: Verify the loop fires when switched on, then switch it back off**

```bash
scripts/analysis/run.sh -c "update public.scoring_weights set value = 1 where key = 'place_needs_edge'"
scripts/analysis/run.sh -c "
with g as (select public.keyword_graph('2026-08-04'::date, null) as j)
select count(*) as nodes,
       count(*) filter (where n->>'word' in ('강남','대구','전남','인천','광주')) as should_be_zero,
       count(*) filter (where n->>'word' in ('서울','부산','호남')) as should_be_three
from g, json_array_elements((select j->'nodes' from g)) n;"
scripts/analysis/run.sh -c "update public.scoring_weights set value = 0 where key = 'place_needs_edge'"
```
Expected: `nodes` 70, `should_be_zero` 0, `should_be_three` 3.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_place_gating.sql
git commit -m "Ask a place for a line to something that is not a place"
```

---

### Task 3: Make the render cap a swept dimension

**Files:**
- Modify: `scripts/analysis/10_sieve_eval.sql:25` (`top_n (n) as (values (70))`)
- Modify: `scripts/analysis/20_unlabeled.sql:29` (same literal)
- Create: `scripts/analysis/24_cap_and_place_configs.sql`

**Interfaces:**
- Produces: `analysis.sieve_configs.render_cap numeric not null default 70` and `.place_gate boolean not null default false`.

The cap is hardcoded in two files. It has to become a column before Task 4 can label past rank 70, and before any cap can be compared with another.

- [ ] **Step 1: Add the columns and the round's rows**

`scripts/analysis/24_cap_and_place_configs.sql`:

```sql
-- Round fourteen: the render cap as a measured dimension, and place gating.
--
-- The cap was a literal 70 in 10_sieve_eval.sql and 20_unlabeled.sql. That was
-- honest while it was not under question; it is a knob now, and a knob in two
-- files is the drift 02_sieve_configs.sql's header warns about.
--
-- Words clearing the shipped sieve, per day: 07-31 116, 08-01 108, 08-02 69,
-- 08-03 260, 08-04 130. So 08-02 cannot fill 70 places and the cap does nothing
-- there, while 08-03 has 260 to choose 130 from. The sweep has to be read per
-- day rather than on a mean.
alter table analysis.sieve_configs
  add column if not exists render_cap numeric not null default 70,
  add column if not exists place_gate boolean not null default false;

insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd,
   demote_head_pos, min_proper, use_dict, render_cap, place_gate)
values
  (200, 'r14: SHIPPED (cap 70)',      3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, false),
  (201, 'r14: cap 85',                3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  85, false),
  (202, 'r14: cap 100',               3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 100, false),
  (203, 'r14: cap 130',               3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 130, false),
  (210, 'r14: place gate, cap 70',    3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, true),
  (211, 'r14: place gate, cap 100',   3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 100, true)
on conflict (ord) do update set
  name = excluded.name, min_headlines = excluded.min_headlines,
  min_standalone = excluded.min_standalone, min_word_len = excluded.min_word_len,
  min_spec = excluded.min_spec, max_npd = excluded.max_npd,
  demote_head_pos = excluded.demote_head_pos, min_proper = excluded.min_proper,
  use_dict = excluded.use_dict, render_cap = excluded.render_cap,
  place_gate = excluded.place_gate;

update analysis.sieve_configs set active = (ord in (200, 201, 202, 203, 210, 211));

select ord, name, render_cap, place_gate from analysis.sieve_configs
where active order by ord;
```

- [ ] **Step 2: Replace the literal in both harness files**

In `10_sieve_eval.sql`, delete the `top_n (n) as (values (70)),` CTE and change `shown`:

```sql
shown as (
  select p.*
  from passed p
  join analysis.sieve_configs c on c.ord = p.ord
  where p.rank <= c.render_cap
),
```

Apply the identical change to `20_unlabeled.sql`. Both files must agree exactly — that is the standing rule in `02_sieve_configs.sql`'s header.

- [ ] **Step 3: Model the place gate in both files**

The harness keeps its own copy of the sieve (that is why `30_word_scores.sql` carries a `chk` column). Add to `passed`'s `where`, after the dictionary clause:

```sql
    -- Sieve 6, as a cut inside the harness's own copy. Unlike keyword_graph this
    -- is a single pass rather than a fixed point: the harness ranks a fixed
    -- candidate list, so there is no promotion to destabilise. Where the two
    -- disagree, keyword_graph is right and 30_word_scores.sql's `chk` says so.
    and (
      not c.place_gate
      or ov.mode is distinct from 'place'
      or exists (
        select 1 from analysis.day_edges de
        where de.d = s.d and (de.a = s.word or de.b = s.word)
          and de.other_is_place = false
      )
    )
```

with `analysis.day_edges` materialised at the top of `24_cap_and_place_configs.sql`:

```sql
drop table if exists analysis.day_edges;
create table analysis.day_edges as
with doc as (
  select distinct h.id as headline_id, n.word, h.collected_date as d
  from public.headline_nouns n
  join public.headlines h on h.id = n.headline_id
  where h.collected_date in (select d from analysis.eval_days)
),
df as (select d, word, count(*)::numeric as df from doc group by 1, 2),
corpus as (select d, count(distinct headline_id)::numeric as n from doc group by 1),
pairs as (
  select a.d, a.word as a, b.word as b, count(*)::int as cooc
  from doc a join doc b on b.headline_id = a.headline_id and b.word > a.word
  group by 1, 2, 3
)
select p.d, p.a, p.b, p.cooc,
       ln((p.cooc * c.n) / (da.df * db.df)) / nullif(-ln(p.cooc / c.n), 0) as npmi,
       (ovb.mode is distinct from 'place') as b_is_place_false,
       (ova.mode is distinct from 'place') as a_is_place_false
from pairs p
join corpus c on c.d = p.d
join df da on da.d = p.d and da.word = p.a
join df db on db.d = p.d and db.word = p.b
left join public.word_overrides ova on ova.word = p.a
left join public.word_overrides ovb on ovb.word = p.b
where p.cooc >= 2;
```

Then `other_is_place` is read per direction; write the `exists` as two branches rather than one, so `a`/`b` asymmetry cannot be got wrong:

```sql
      or exists (
        select 1 from analysis.day_edges de
        where de.d = s.d and de.npmi >= 0.3
          and ((de.a = s.word and de.b_is_place_false)
            or (de.b = s.word and de.a_is_place_false))
      )
```

- [ ] **Step 4: Verify the change is inert before it is used**

```bash
scripts/analysis/run.sh scripts/analysis/12_eval_days.sql
scripts/analysis/run.sh scripts/analysis/02_sieve_configs.sql
scripts/analysis/run.sh scripts/analysis/16_proper_noun_configs.sql
scripts/analysis/run.sh scripts/analysis/19_rounds_ten_to_twelve_configs.sql
scripts/analysis/run.sh scripts/analysis/10_sieve_eval.sql | tee /tmp/eval-180.txt
```
Expected: row `SHIPPED after 0021` reads day-wide F1 62.43 / precision 90.35 as `README.md` records for config 180, with `unlab` 0 and `story_rank` 1 on all four days. **If that row moved, the cap refactor broke something** — it must reproduce before the new rows mean anything.

- [ ] **Step 5: Commit**

```bash
git add scripts/analysis/10_sieve_eval.sql scripts/analysis/20_unlabeled.sql \
        scripts/analysis/24_cap_and_place_configs.sql
git commit -m "Let the harness ask how many words a screen should hold"
```

---

### Task 4: Label everything the new rows put on screen

**Files:**
- Create: `scripts/analysis/25_labels_deep_ranks.sql`

Rule 4: a row whose `unlabeled` is not 0 is measuring a fraction of the screen and means nothing. Ranks 71–130 have never been on screen, so this is the largest single labelling pass since round eight.

- [ ] **Step 1: Get the worklist**

```bash
scripts/analysis/run.sh scripts/analysis/24_cap_and_place_configs.sql
scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql | tee /tmp/worklist-day.txt
scripts/analysis/run.sh scripts/analysis/21_unlabeled_category.sql | tee /tmp/worklist-cat.txt
```

- [ ] **Step 2: Label them**

Write `25_labels_deep_ranks.sql` as `insert into analysis.word_labels (word, label) values … on conflict (word) do nothing`, one row per word from both worklists. Judge each with the operational question `README.md` records: **would this word appear in a randomly chosen other week's news?** If yes it is `bad` however particular the story behind it (압수수색, 본회의, 유상증자); if no it is `good` (문자통보, 미장착). Watch for the section-tag signature — `spec` 1.00 plus a shared bracketed suffix means newspaper furniture, not a subject.

- [ ] **Step 3: Apply and confirm both worklists are empty**

```bash
scripts/analysis/run.sh scripts/analysis/25_labels_deep_ranks.sql
scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql
scripts/analysis/run.sh scripts/analysis/21_unlabeled_category.sql
```
Expected: both print `(no rows)`. If not, label the remainder and repeat — this took two passes in round thirteen and four in round three.

- [ ] **Step 4: Commit**

```bash
git add scripts/analysis/25_labels_deep_ranks.sql
git commit -m "Label the ranks nobody has ever had to look at"
```

---

### Task 5: `df_balanced` in `keyword_signals`

**Files:**
- Create: `supabase/migrations/0025_category_balance.sql`

**Interfaces:**
- Produces: `keyword_signals(p_date date, p_alpha numeric default null)` gains a `df_balanced numeric` column. `p_alpha` null reads `scoring_weights.category_balance_alpha`.
- Produces: `scoring_weights` key `category_balance_alpha`, 0 = identity.

α is a **parameter** rather than only a weight because the harness has to sweep it, and a second copy of the formula in `10_sieve_eval.sql` is exactly what this repository forbids. The default keeps all five existing callers working unchanged.

- [ ] **Step 1: Write the migration**

```sql
-- 0025: df_balanced — what the count would have been under equal collection.
--
-- 2026-08-04 collected society 282 and it 96, and that gap is not a cap doing
-- its job: at 07:00 that day no section reached the 150 window at all
-- (society 99 new, it 24). The sections publish at different rates and paging
-- deeper returns articles already held, so **balance cannot be had at
-- collection time** and is taken here instead.
--
--   df_balanced(α) = Σ_c  df_c × (N̄ / N_c)^α
--
-- df_c is the word's headline count inside section c, N_c that section's day
-- total, N̄ the mean of the six. At α = 1 this is the count under equal
-- collection — the estimator the request actually asked for. At α = 0 it is df,
-- so the shipped configuration enters its own sweep as the control.
--
-- **The denominator is the word's own section distribution, not its top
-- category.** 폭염 spans sections and its top category is society, the largest —
-- a single denominator would charge it the largest divisor and put rule 5 (never
-- drop the day's biggest story) directly at risk. A spread word gets a blend.
--
-- **Size is untouched.** The label stays proportional to the raw headline count;
-- only the order moves. Same shape as the head_pos demotion.
--
-- **Free implementation check**: inside one category the denominator is a
-- constant multiple, so the ranking there is mathematically unchanged.
-- 11_category_eval.sql must not move by a digit.

insert into public.scoring_weights (key, value, note) values
  ('category_balance_alpha', 0,
   'sieve ranking: 0 = raw frequency (identity), 1 = the count under equal collection. Set by 0027 after measurement.')
on conflict (key) do update set value = excluded.value, note = excluded.note;

drop function if exists public.keyword_signals(date);

create or replace function public.keyword_signals(p_date date, p_alpha numeric default null)
returns table(
  word text, df integer, df_balanced numeric, spec numeric, standalone numeric,
  neighbors_per_doc numeric, assoc numeric, head_pos numeric, proper numeric,
  category_slug text
)
language sql
stable
set search_path to ''
as $function$
with
alpha as (
  select coalesce(p_alpha,
                  (select value from public.scoring_weights
                    where key = 'category_balance_alpha'), 0) as a
),
-- … every existing CTE from 0017 unchanged …
cat_totals as (
  select c.slug, count(*)::numeric as n
  from public.headlines h
  join public.categories c on c.id = h.category_id
  where h.collected_date = p_date
  group by c.slug
),
cat_mean as (select avg(n) as nbar from cat_totals),
balanced as (
  select
    w.word,
    sum(w.cnt * power(cm.nbar / ct.n, al.a))::numeric as df_balanced
  from (select d.word, d.category_slug, count(*)::numeric as cnt
        from doc d group by d.word, d.category_slug) w
  join cat_totals ct on ct.slug = w.category_slug
  cross join cat_mean cm
  cross join alpha al
  group by w.word
)
select
  df.word, df.df, balanced.df_balanced, spec.spec, standalone.standalone,
  coalesce(neighbors.distinct_neighbors, 0) / df.df, assoc.assoc,
  coalesce(head_pos.head_pos, 0)::numeric, coalesce(proper.proper, 0)::numeric,
  top_category.category_slug
from df
join spec on spec.word = df.word
join standalone on standalone.word = df.word
join balanced on balanced.word = df.word
join top_category on top_category.word = df.word
left join neighbors on neighbors.word = df.word
left join assoc on assoc.word = df.word
left join head_pos on head_pos.word = df.word
left join proper on proper.word = df.word;
$function$;

grant execute on function public.keyword_signals(date, numeric) to anon;
```

Then point `keyword_graph_nodes`'s `ranked` CTE at it:

```sql
    row_number() over (
      order by (s.head_pos > w.demote_head_pos) asc,
               s.df_balanced desc, s.count desc, s.word) as rank
```

- [ ] **Step 2: Apply and verify α = 0 is the identity**

```bash
npx supabase db push --password "$SUPABASE_DB_PASSWORD"
scripts/analysis/run.sh -c "
select count(*) as mismatches
from public.keyword_signals('2026-08-03'::date) s
where s.df_balanced <> s.df::numeric;"
```
Expected: `mismatches` 0. Then re-run the five graph hashes from Task 2 Step 2. Expected: all five unchanged.

- [ ] **Step 3: Verify α = 1 moves what it should**

```bash
scripts/analysis/run.sh -c "
select s.word, s.df, round(s.df_balanced, 1) as bal, s.category_slug
from public.keyword_signals('2026-08-04'::date, 1.0) s
where s.df >= 8 order by s.df_balanced desc limit 20;"
```
Expected: `it` and `world` words rise relative to `society` ones, and 폭염 — which spans sections — sits between rather than at either extreme. Record what it does to 폭염 in the commit message; rule 5 turns on it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0025_category_balance.sql
git commit -m "Count a word as if every section had been read to the same depth"
```

---

### Task 6: Sweep α in the harness

**Files:**
- Modify: `scripts/analysis/10_sieve_eval.sql`, `20_unlabeled.sql` (call `keyword_signals` per config)
- Modify: `scripts/analysis/11_category_eval.sql`, `21_unlabeled_category.sql` (α variants)
- Modify: `scripts/analysis/24_cap_and_place_configs.sql` (α column and rows)

- [ ] **Step 1: Add the column and rows**

```sql
alter table analysis.sieve_configs
  add column if not exists balance_alpha numeric not null default 0;

insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd,
   demote_head_pos, min_proper, use_dict, render_cap, place_gate, balance_alpha)
values
  (220, 'r14: alpha .25',  3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 70, false, 0.25),
  (221, 'r14: alpha .50',  3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 70, false, 0.50),
  (222, 'r14: alpha .75',  3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 70, false, 0.75),
  (223, 'r14: alpha 1.00', 3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 70, false, 1.00)
on conflict (ord) do update set balance_alpha = excluded.balance_alpha,
  render_cap = excluded.render_cap, place_gate = excluded.place_gate;
```

- [ ] **Step 2: Make `sig` per-configuration in `10_sieve_eval.sql`**

Replace the `sig` CTE and `passed`'s `cross join sig s` with a lateral over the config:

```sql
passed as (
  select
    c.ord, c.name, p.d, s.word, s.df,
    row_number() over (partition by c.ord, p.d
      order by (s.head_pos > c.demote_head_pos) asc,
               s.df_balanced desc, s.df desc, s.word) as rank
  from analysis.sieve_configs c
  cross join params p
  cross join lateral keyword_signals(p.d, c.balance_alpha) s
  left join word_overrides ov on ov.word = s.word
  where c.active
    …unchanged clauses…
),
```
`pool` keeps using a plain `keyword_signals(p.d)` — the recall denominator must stay fixed across configurations, exactly as it is held at `df >= 3` today.

Apply the same change to `20_unlabeled.sql`.

- [ ] **Step 3: Add α variants to the category harness**

In `11_category_eval.sql` and `21_unlabeled_category.sql`, add rows to `variants` and thread α through the `day_pass`/`sig` calls:

```sql
  (7, 'ships, alpha 1.00',             'day',    3, null::numeric, 1.00),
```
extending the `variants` tuple with a sixth element `alpha`, defaulting the existing five rows to `0`.

- [ ] **Step 4: Run and check the invariant**

```bash
scripts/analysis/run.sh scripts/analysis/24_cap_and_place_configs.sql
scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql   # label anything new, then repeat
scripts/analysis/run.sh scripts/analysis/21_unlabeled_category.sql
scripts/analysis/run.sh scripts/analysis/11_category_eval.sql | tee /tmp/cat-alpha.txt
```
Expected: **the α 1.00 variant's numbers are identical to the shipped variant's, cell for cell.** Inside one category the denominator is a constant multiple and cannot reorder anything. A difference means the α plumbing is wrong — most likely α applied to a scoped count rather than a day-wide one.

- [ ] **Step 5: Commit**

```bash
git add scripts/analysis/
git commit -m "Sweep the balance, and let the category harness prove it is a no-op there"
```

---

### Task 7: Read the harness and ship the values

**Files:**
- Create: `supabase/migrations/0026_enable_place_and_balance.sql`
- Modify: `scripts/analysis/README.md` (round fourteen)

- [ ] **Step 1: Run the full harness**

```bash
scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql        # must print (no rows)
scripts/analysis/run.sh scripts/analysis/21_unlabeled_category.sql
scripts/analysis/run.sh scripts/analysis/10_sieve_eval.sql  | tee /tmp/r14-day.txt
scripts/analysis/run.sh scripts/analysis/11_category_eval.sql | tee /tmp/r14-cat.txt
```

- [ ] **Step 2: Decide, against the rules rather than the eye**

- Any row with `unlab` ≠ 0 is discarded (rule 4).
- Any row with `story_rank` = `DROPPED` is rejected regardless of precision (rule 5).
- Prefer an interior optimum; if the best α or cap is at the edge of the sweep, widen the sweep and go back to Task 4 (rule 2).
- **Place gating is a cut.** If it wins day-wide and loses category cells while winning none, that is the head_pos signature: the mechanism needs the cap to be binding. Do not move a threshold — reconsider the mechanism, and write that down.
- Read the cap **per day**. 2026-08-02 clears 69 words, so its numbers cannot move with the cap and a mean would hide that.

- [ ] **Step 3: Write the migration with the measured values**

```sql
-- 0026: turn on what round fourteen measured.
--
-- <paste the harness table here — the configurations, their day-wide F1 and
--  precision, the 24 category cells, and story_rank for every row. State which
--  value is mid-plateau and which is a boundary, the way 0019 and 0020 do.>

update public.scoring_weights set value = 1,
  note = 'sieve 6: a word_overrides place is drawn only when a line joins it to a non-place. Measured in round fourteen: <numbers>.'
 where key = 'place_needs_edge';

update public.scoring_weights set value = <measured>,
  note = 'ranking: df_balanced exponent. <why this cell and not its neighbour>.'
 where key = 'category_balance_alpha';

update public.scoring_weights set value = <measured> where key in ('render_cap', 'node_limit');
```

`render_cap` and `node_limit` move **together**. Migration `0006` made them equal so `faded` can only mean a `demote` entry, and splitting them again would silently reintroduce faded minimum-size labels in every gap.

- [ ] **Step 4: Apply, then confirm the app agrees with the harness**

```bash
npx supabase db push --password "$SUPABASE_DB_PASSWORD"
scripts/analysis/run.sh scripts/analysis/30_word_scores.sql | tee /tmp/r14-scores.txt
```
Expected: the `chk` column holds no `!`. A `!` means `30_word_scores.sql`'s own copy of the sieve has drifted from `keyword_graph` — update the copy (it needs the place clause and `df_balanced` ordering), not the sieve.

- [ ] **Step 5: Write the round up in `scripts/analysis/README.md`**

Follow the existing rounds' shape: what was asked, the table, what was rejected and why, and the transferable lesson. Name the cost — which good words the gate removed — the way round ten named 우크라, 충청 and 해남.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0026_enable_place_and_balance.sql \
        scripts/analysis/README.md scripts/analysis/30_word_scores.sql
git commit -m "Turn on what round fourteen measured"
```

---

### Task 8: Re-test collection depth

**Files:**
- Modify: `supabase/functions/collect-headlines/index.ts:62-63`

Independent of Tasks 1–7; do it whenever. This is **not** equalisation — it is recovering news missed when the cap binds after a gap, which it did on 2026-08-03 at 07:00 when all six sections stored exactly 150.

- [ ] **Step 1: Record the current cost**

```bash
curl -sS -X POST "https://<ref>.supabase.co/functions/v1/collect-headlines" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" | python -m json.tool
```
Note `elapsedMs` and each section's `collected` figure.

- [ ] **Step 2: Raise both constants**

```ts
const MAX_HEADLINES_PER_CATEGORY = 300
const MAX_LIST_PAGES = 12
```

- [ ] **Step 3: Deploy and measure**

```bash
npx supabase functions deploy collect-headlines --project-ref "$SUPABASE_PROJECT_REF"
```
Invoke it and read the response. **Judge on CPU, not the wall clock** — a killed run returns no body at all, so check the function logs for `CPU Time exceeded` and read the `CHK <category> scraped/processed` lines. A 546 with no body is a failure whatever `elapsedMs` said last time; the 300-over-12-pages attempt died that way once and was misdiagnosed as a wall-clock wall.

- [ ] **Step 4: Keep or revert on the evidence, and rewrite the comment either way**

The comment block at `index.ts:22-61` currently says the measurement needs re-testing. Replace it with what this run found — including "it was tried and it still dies" if that is the answer.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/collect-headlines/index.ts
git commit -m "Find out what the CPU budget actually allows"
```

---

# Round 2 — canvas

### Task 9: Re-pull the fixture and re-baseline

**Files:**
- Modify: `scripts/layout/graphDays.json`
- Modify: `scripts/layout/README.md`

Round 1 changed which words are drawn and therefore which edges exist. Every layout number measured against the old fixture describes a screen the app no longer draws — migration `0007` recorded that trap once already.

- [ ] **Step 1: Re-pull**

```bash
node scripts/layout/pullFixture.mjs scripts/layout/graphDays.json
```

- [ ] **Step 2: Re-baseline**

```bash
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/measure.ts | tee /tmp/layout-baseline.txt
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/bridges.ts
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/planarity.ts
```

- [ ] **Step 3: Replace the table in `scripts/layout/README.md`**

Paste the new baseline under a heading naming the sieve it came from. Note the node count — if the cap moved, `nodes` is no longer 70 and every per-day comparison with the old table is void.

- [ ] **Step 4: Commit**

```bash
git add scripts/layout/graphDays.json scripts/layout/README.md
git commit -m "Re-pull the fixture the sieve just invalidated"
```

---

### Task 10: Scatter the edgeless words

**Files:**
- Modify: `src/components/graphLayout.ts`
- Test: `src/components/graphLayout.test.ts`

**Interfaces:**
- Produces: `scatterLoose(loose: LayoutNode[], placed: PlacedNode[], curves: EdgeCurve[], options: { padding: number; bounds: { x: number; y: number; width: number; height: number } }): LayoutNode[]` — positions what it can and **returns the nodes it could not place**, in input order.
- Consumes: `intrusion(curve, boxes, margin)` and `LABEL_CLEARANCE`, both already in the file.

**The order is the design.** Edges are routed first and their curves become obstacles, so nothing is re-routed and every curve's `clear` verdict stays true. That is what makes `crowded` unable to rise — the failure that sank the old inner-ring placement is an invariant here rather than a risk.

Occupancy is rasterised into a uniform grid so a candidate costs a few dozen cell reads instead of a walk over every label and curve. Rasterising is conservative — it over-rejects at cell granularity — which is the safe direction, and the test asserts exact non-intrusion afterwards with `intrusion` itself.

- [ ] **Step 1: Write the failing test**

```ts
import { computeGraphLayout, routeEdge } from './graphLayout'

// 32 samples is what routeEdge's own intrusion() walks; the same points are
// what scatterLoose treats as solid.
function curvePoints(c: { x1: number; y1: number; cx: number; cy: number; x2: number; y2: number }) {
  return Array.from({ length: 33 }, (_, i) => {
    const t = i / 32
    const m = 1 - t
    return {
      x: m * m * c.x1 + 2 * m * t * c.cx + t * t * c.x2,
      y: m * m * c.y1 + 2 * m * t * c.cy + t * t * c.y2,
    }
  })
}

it('never puts a scattered word on top of an edge', () => {
  const words = [
    ...['트럼프', '이스라엘', '하마스', '압박', '휴전', '가자'].map((word, i) => ({
      word, count: 20 - i, fontSize: 30, textWidth: word.length * 28, faded: false,
    })),
    ...['월요일', '가능성', '변동성', '막바지', '무방비', '시험대'].map((word) => ({
      word, count: 4, fontSize: 16, textWidth: word.length * 15, faded: false,
    })),
  ]
  const edges = [
    { a: '트럼프', b: '이스라엘', cooc: 9, npmi: 0.8 },
    { a: '이스라엘', b: '하마스', cooc: 7, npmi: 0.7 },
    { a: '하마스', b: '압박', cooc: 5, npmi: 0.6 },
    { a: '압박', b: '휴전', cooc: 4, npmi: 0.5 },
    { a: '휴전', b: '가자', cooc: 4, npmi: 0.5 },
  ]

  const layout = computeGraphLayout(words, edges, { width: 900 })
  const linked = new Set(edges.flatMap((e) => [e.a, e.b]))
  const scattered = layout.nodes.filter((n) => !linked.has(n.word))

  expect(scattered.length).toBe(6)
  for (const node of scattered) {
    for (const edge of layout.edges) {
      if (!edge.curve) continue
      for (const p of curvePoints(edge.curve)) {
        const onLabel =
          Math.abs(p.x - node.x) < node.halfWidth &&
          Math.abs(p.y - node.y) < node.halfHeight
        expect(onLabel, `${node.word} sits on ${edge.a}—${edge.b}`).toBe(false)
      }
    }
  }
})

it('places at least one edgeless word above the packed regions', () => {
  // The band used to hold all of them, so every edgeless word was below every
  // region. Scattering means at least one is not.
  const words = [
    ...['트럼프', '이스라엘', '하마스', '압박'].map((word, i) => ({
      word, count: 20 - i, fontSize: 30, textWidth: word.length * 28, faded: false,
    })),
    ...['월요일', '가능성', '변동성'].map((word) => ({
      word, count: 4, fontSize: 16, textWidth: word.length * 15, faded: false,
    })),
  ]
  const edges = [
    { a: '트럼프', b: '이스라엘', cooc: 9, npmi: 0.8 },
    { a: '이스라엘', b: '하마스', cooc: 7, npmi: 0.7 },
    { a: '하마스', b: '압박', cooc: 5, npmi: 0.6 },
  ]
  const layout = computeGraphLayout(words, edges, { width: 900 })
  const lowestRegion = Math.max(...layout.regions.map((r) => r.y + r.height))
  const loose = layout.nodes.filter((n) => ['월요일', '가능성', '변동성'].includes(n.word))
  expect(loose.some((n) => n.y < lowestRegion)).toBe(true)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/graphLayout.test.ts -t "edge"`
Expected: the second test fails — every edgeless word currently sits in the band under the regions, so none is above `lowestRegion`. The first may pass by luck; it is a regression guard, not the driver.

- [ ] **Step 3: Implement `scatterLoose`**

```ts
// 흩뿌리기용 점유 격자의 한 칸. 작을수록 촘촘하지만 O(cells)가 두 번 든다 —
// 라벨 최소 높이(14 * 1.2)의 절반쯤이면 한 칸이 글자보다 작아 보수적으로 안전하다.
const SCATTER_CELL = 8

/**
 * 선을 장애물로 삼아 무연결 단어를 그림 전체에 흩뿌린다.
 *
 * **순서가 설계다.** 엣지를 먼저 라우팅하고 그 곡선을 장애물로 쓰므로, 여기서
 * 놓은 단어가 이미 그려진 선을 건드릴 수 없다. 곡선을 다시 계산하지 않으니
 * `clear` 판정이 그대로 유효하고, `crowded`는 오를 수 없다 — 예전에 무연결
 * 단어를 캔버스 안쪽 고리로 보냈다가 모든 선이 남의 사건을 관통했던 바로 그
 * 지점이 여기서는 불변식이 된다.
 *
 * 자리는 격자를 훑어 고른다. 통과한 후보 중 **이미 놓인 것들로부터 제일 먼**
 * 곳을 고르는데, 그게 "고르게 흩뿌린다"의 산술적 정의이기 때문이다. 거리는
 * 점유 칸에서 시작한 다중 출발 BFS로 한 번에 구하므로 후보당 O(1)이다.
 *
 * 못 놓은 단어는 돌려준다. 부르는 쪽이 아래 띠로 흘린다 — 폰에서는 빈틈이
 * 거의 없어 대부분 그리로 가는데, 그건 특별 취급이 아니라 자연스러운 저하다.
 */
export function scatterLoose(
  loose: LayoutNode[],
  placed: PlacedNode[],
  curves: EdgeCurve[],
  options: { padding: number; bounds: { x: number; y: number; width: number; height: number } },
): LayoutNode[] {
  const { padding, bounds } = options
  const cols = Math.max(1, Math.ceil(bounds.width / SCATTER_CELL))
  const rows = Math.max(1, Math.ceil(bounds.height / SCATTER_CELL))
  const solid = new Uint8Array(cols * rows)

  const markBox = (x: number, y: number, halfWidth: number, halfHeight: number) => {
    const c0 = Math.max(0, Math.floor((x - halfWidth - bounds.x) / SCATTER_CELL))
    const c1 = Math.min(cols - 1, Math.floor((x + halfWidth - bounds.x) / SCATTER_CELL))
    const r0 = Math.max(0, Math.floor((y - halfHeight - bounds.y) / SCATTER_CELL))
    const r1 = Math.min(rows - 1, Math.floor((y + halfHeight - bounds.y) / SCATTER_CELL))
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) solid[r * cols + c] = 1
  }

  for (const node of placed) {
    markBox(node.x, node.y, node.halfWidth + padding / 2, node.halfHeight + padding / 2)
  }
  // 곡선은 라우팅이 이미 쓰는 32구간 샘플 그대로 찍는다. 두 번째 사본을 만들지
  // 않으려는 것이고, 그래야 여기서 피한 점과 저기서 센 점이 같은 점이 된다.
  for (const curve of curves) {
    for (let i = 0; i <= 32; i++) {
      const t = i / 32
      const m = 1 - t
      markBox(
        m * m * curve.x1 + 2 * m * t * curve.cx + t * t * curve.x2,
        m * m * curve.y1 + 2 * m * t * curve.cy + t * t * curve.y2,
        LABEL_CLEARANCE,
        LABEL_CLEARANCE,
      )
    }
  }

  const fits = (node: LayoutNode, x: number, y: number) => {
    const halfWidth = node.halfWidth + padding / 2
    const halfHeight = node.halfHeight + padding / 2
    if (x - halfWidth < bounds.x || x + halfWidth > bounds.x + bounds.width) return false
    if (y - halfHeight < bounds.y || y + halfHeight > bounds.y + bounds.height) return false
    const c0 = Math.floor((x - halfWidth - bounds.x) / SCATTER_CELL)
    const c1 = Math.floor((x + halfWidth - bounds.x) / SCATTER_CELL)
    const r0 = Math.floor((y - halfHeight - bounds.y) / SCATTER_CELL)
    const r1 = Math.floor((y + halfHeight - bounds.y) / SCATTER_CELL)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solid[r * cols + c]) return false
    return true
  }

  // 점유 칸에서 출발하는 다중 출발 BFS. 각 칸이 제일 가까운 장애물까지 몇 칸인지.
  const distance = () => {
    const d = new Int32Array(cols * rows).fill(-1)
    let frontier: number[] = []
    for (let i = 0; i < solid.length; i++) if (solid[i]) { d[i] = 0; frontier.push(i) }
    let step = 0
    while (frontier.length > 0) {
      step++
      const next: number[] = []
      for (const i of frontier) {
        const r = (i / cols) | 0
        const c = i % cols
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
          const j = rr * cols + cc
          if (d[j] !== -1) continue
          d[j] = step
          next.push(j)
        }
      }
      frontier = next
    }
    return d
  }

  // 큰 단어부터. 큰 것이 나중에 오면 들어갈 구멍이 이미 없다.
  const order = [...loose].sort(
    (a, b) => b.halfWidth * b.halfHeight - a.halfWidth * a.halfHeight || a.word.localeCompare(b.word),
  )
  const leftover: LayoutNode[] = []

  for (const node of order) {
    const d = distance()
    let best = -1
    let bestScore = -1
    for (let i = 0; i < d.length; i++) {
      if (d[i] <= 0 || d[i] <= bestScore) continue
      const r = (i / cols) | 0
      const c = i % cols
      const x = bounds.x + c * SCATTER_CELL + SCATTER_CELL / 2
      const y = bounds.y + r * SCATTER_CELL + SCATTER_CELL / 2
      if (!fits(node, x, y)) continue
      bestScore = d[i]
      best = i
    }
    if (best < 0) {
      leftover.push(node)
      continue
    }
    const r = (best / cols) | 0
    const c = best % cols
    node.x = bounds.x + c * SCATTER_CELL + SCATTER_CELL / 2
    node.y = bounds.y + r * SCATTER_CELL + SCATTER_CELL / 2
    markBox(node.x, node.y, node.halfWidth + padding / 2, node.halfHeight + padding / 2)
  }

  // 입력 순서로 돌려준다 — 아래 띠의 줄 배치가 빈도순을 기대한다.
  const stranded = new Set(leftover.map((n) => n.word))
  return loose.filter((n) => stranded.has(n.word))
}
```

- [ ] **Step 4: Rewire `computeGraphLayout`**

The loose band currently runs before the edges are routed. Move it after, and feed the leftovers to `flowRows`:

```ts
  // 엣지를 먼저 라우팅한다. 곡선이 흩뿌리기의 장애물이기 때문이고, 그 순서라야
  // 여기서 놓은 단어가 이미 그려진 선을 건드릴 수 없다.
  const loose = nodes.filter((n) => !eventOf.has(n.word))
  const anchored = nodes.filter((n) => eventOf.has(n.word))
  const anchoredPlaced: PlacedNode[] = anchored.map(toPlaced)
  const routed = links.map((l) => routeEdge(byPlaced(l.a), byPlaced(l.b), anchoredPlaced))

  const stranded = scatterLoose(loose, anchoredPlaced, routed.filter((c): c is EdgeCurve => c !== null), {
    padding,
    bounds: { x: 0, y: 0, width: Math.max(width, packed.width), height: packed.height },
  })

  const looseTop = packed.height > 0 && stranded.length > 0 ? packed.height + gutter : packed.height
  const looseSize = flowRows(stranded, width, padding, looseTop)
```

`routeEdge` is called once, with the anchored nodes only. Scattered words are not obstacles for the curves — they were placed to avoid the curves, so the relation is symmetric and re-routing would only make the curves bend around words they already miss.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/graphLayout.test.ts`
Expected: PASS, including the existing region-overlap and label-overlap invariants.

- [ ] **Step 6: Type check**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/graphLayout.ts src/components/graphLayout.test.ts
git commit -m "Let a loose word sit anywhere a line does not already go"
```

---

### Task 11: Measure the scatter

**Files:**
- Modify: `scripts/layout/measure.ts`
- Modify: `scripts/layout/README.md`

- [ ] **Step 1: Add an `inRegion` column**

In `measure.ts`, after the layout is computed, count the nodes that hold no edge and whose centre falls inside some `layout.regions` rectangle. Print it beside `overlap`.

- [ ] **Step 2: Run the harness**

```bash
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/measure.ts | tee /tmp/layout-scatter.txt
node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/bridges.ts
```

- [ ] **Step 3: Judge it**

- `overlap` **must be 0 everywhere.** No exception, no trade.
- `crowded` **must not rise.** The design says it cannot; if it did, `scatterLoose` is being called before routing or the curve sampling disagrees with `intrusion`'s.
- `xIn` and `xBr` are read separately. A change in total `crossings` decides nothing — the region rewrite dropped `crowded` on all eight cells while raising the total on three.
- `height` should fall on desktop, since the band shrinks. If it does not, the scatter is finding no room and the whole change is cosmetic.
- Read `inRegion`. If a region is carrying several strangers on every day, restrict candidates to cells outside every region rectangle and re-measure — that is a one-line change to `fits`.

- [ ] **Step 4: Write the table into `scripts/layout/README.md`**

- [ ] **Step 5: Commit**

```bash
git add scripts/layout/measure.ts scripts/layout/README.md
git commit -m "Price the scatter, including how often it lands in somebody's story"
```

---

### Task 12: Widen the graph

**Files:**
- Modify: `src/App.tsx:420` (the `<main>` container)

- [ ] **Step 1: Split the container**

`<main>` keeps `max-w-6xl` for the masthead and the error block. The graph's wrapper gets its own wider box:

```tsx
          <div
            className={`mx-auto w-full max-w-[1600px] origin-top transition-transform duration-300 motion-reduce:transition-none ${
              selectedWord || selectedEvent ? 'sm:-translate-x-24 sm:scale-90' : ''
            }`}
          >
```
and `<main>`'s own `max-w-6xl` moves onto the masthead and error wrappers so prose keeps its measure. The event list travels inside `KeywordGraph`'s `header` slot, so cap it there rather than widening it.

**Why this is not the "widening buys nothing" case.** That finding is about spreading words sideways *within* a container: the SVG is drawn at its cropped size and scaled by `max-w-full`, so a wider spread just scales down further. Growing the container is different — the layout runs at a larger width, so less is scaled away and more shelves fit per row.

- [ ] **Step 2: Add the wide viewport to the layout harness**

In `measure.ts`, add a third view at 1600px beside `desktop` (1280) and `phone` (358). Run it and confirm `overlap` stays 0 and `height` falls.

- [ ] **Step 3: Look at it**

Run: `npm run dev` and open the app at a wide window. Check that the masthead and the event list have not grown a longer line, and that the graph fills the extra width rather than centring a small drawing in it.

- [ ] **Step 4: Run the e2e suite**

Run: `npm run test:e2e`
Expected: pass. `appControls.spec.ts` asserts on the skeleton's insertion and `keywordGraph.spec.ts` on drawn words — neither should notice the width, and a failure means the container change moved something it should not have.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx scripts/layout/measure.ts
git commit -m "Give the canvas the width the prose does not need"
```

---

### Task 13: The per-section share, in the database

**Files:**
- Create: `supabase/migrations/0027_daily_category_counts.sql`
- Modify: `src/lib/queries.ts`
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Produces: view `public.daily_category_counts (date date, slug text, headlines int, capped boolean)`.
- Produces: `fetchCategoryShare(date: string): Promise<CategoryShare[]>` where `CategoryShare = { slug: string; headlines: number; capped: boolean }`, cached through `queryCache`.

- [ ] **Step 1: Write the migration**

```sql
-- 0027: what each section actually produced, per day.
--
-- The counts are the real proportions rather than an artefact of the cap: on
-- 2026-08-04 at 07:00 no section reached its 150-headline window (society 99
-- new, it 24), so what is stored is what was published. That is exactly why
-- collection cannot be equalised by paging deeper, and it is why this view can
-- be read as a share at all.
--
-- `capped` is the caveat made machine-readable. After a gap the window does
-- bind — 2026-08-03 07:00 stored exactly 150 for all six — and that section's
-- share is then a lower bound. A pie chart that cannot say so is not worth
-- drawing.
--
-- **Read it filtered by date.** Six rows a day reaches PostgREST's 1,000-row cap
-- in 166 days, and a silently truncated denominator is the failure this
-- repository has already paid for once.

create or replace view public.daily_category_counts
with (security_invoker = on) as
with per_run as (
  select h.collected_date as date, c.slug,
         date_trunc('minute', h.created_at) as run,
         count(*) as n
  from public.headlines h
  join public.categories c on c.id = h.category_id
  group by 1, 2, 3
)
select date, slug,
       sum(n)::int as headlines,
       bool_or(n >= 150) as capped
from per_run
group by date, slug;

grant select on public.daily_category_counts to anon;
```

- [ ] **Step 2: Write the failing test**

In `src/lib/queries.test.ts`, following the existing pattern (`clearQueryCache()` in `beforeEach`):

```ts
it('returns one row per section, newest date filtered server side', async () => {
  const fetchMock = mockResponse([
    { date: '2026-08-04', slug: 'society', headlines: 282, capped: false },
    { date: '2026-08-04', slug: 'it', headlines: 96, capped: false },
  ])
  const share = await fetchCategoryShare('2026-08-04')
  expect(share).toEqual([
    { slug: 'society', headlines: 282, capped: false },
    { slug: 'it', headlines: 96, capped: false },
  ])
  expect(fetchMock.mock.calls[0][0]).toContain('date=eq.2026-08-04')
})

it('serves a repeated read from the cache', async () => {
  const fetchMock = mockResponse([{ date: '2026-08-04', slug: 'it', headlines: 96, capped: false }])
  const first = fetchCategoryShare('2026-08-04')
  const second = fetchCategoryShare('2026-08-04')
  expect(await first).toBe(await second)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/queries.test.ts -t "section"`
Expected: FAIL — `fetchCategoryShare is not defined`.

- [ ] **Step 4: Implement it**

```ts
export interface CategoryShare {
  slug: string
  headlines: number
  capped: boolean
}

// 하루 여섯 행이므로 **날짜로 반드시 거른다.** 거르지 않으면 166일 만에
// PostgREST의 1,000행 상한에 닿고, 잘린 응답으로 계산한 비율은 아무 말도 없이
// 틀린다 — 이 저장소가 이미 한 번 값을 치른 실패다.
export const fetchCategoryShare = cached('categoryShare', async (date: string) => {
  const { data, error } = await postgrest
    .from('daily_category_counts')
    .select('slug, headlines, capped')
    .eq('date', date)
  if (error) throw error
  return (data ?? []) as CategoryShare[]
})
```

- [ ] **Step 5: Run the tests and the build**

Run: `npx vitest run src/lib/queries.test.ts` then `npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0027_daily_category_counts.sql src/lib/queries.ts src/lib/queries.test.ts
git commit -m "Publish what each section actually produced, and whether the cap hid some of it"
```

---

### Task 14: The donut

**Files:**
- Create: `src/components/CategoryShare.tsx`
- Create: `src/components/CategoryShare.test.tsx`
- Modify: `src/App.tsx`
- Modify: `e2e/support/mockSupabase.ts`
- Modify: `e2e/keywordGraph.spec.ts`

**Interfaces:**
- Consumes: `fetchCategoryShare` from Task 13, `sectionColorFor` from `src/lib/sectionColors.ts`.

- [ ] **Step 1: Read the dataviz skill**

Load the `dataviz` skill before writing any chart code. It is required, not optional, and it covers the palette and legend rules this component has to satisfy.

- [ ] **Step 2: Write the failing test**

```tsx
it('labels each arc with its section and share', () => {
  render(
    <CategoryShare
      share={[
        { slug: 'society', headlines: 282, capped: false },
        { slug: 'it', headlines: 96, capped: false },
      ]}
      categories={[
        { slug: 'society', name: '사회' },
        { slug: 'it', name: 'IT/과학' },
      ]}
    />,
  )
  expect(screen.getByText('사회')).toBeInTheDocument()
  expect(screen.getByText('75%')).toBeInTheDocument()
  expect(screen.getByText('25%')).toBeInTheDocument()
})

it('says so when the cap hid part of a section', () => {
  render(
    <CategoryShare
      share={[
        { slug: 'society', headlines: 150, capped: true },
        { slug: 'it', headlines: 50, capped: false },
      ]}
      categories={[{ slug: 'society', name: '사회' }, { slug: 'it', name: 'IT/과학' }]}
    />,
  )
  expect(screen.getByText(/최소치/)).toBeInTheDocument()
})

it('draws nothing at all when the day has no counts', () => {
  const { container } = render(<CategoryShare share={[]} categories={[]} />)
  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/components/CategoryShare.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement it**

An SVG donut. Arcs are `<path>` elements with `style={{ fill: sectionColorFor(slug) }}` — inline `style`, never a presentation attribute, because `var()` is unreliable in the latter. The colour comes from `sectionColors.ts` and nowhere else: the tab row and the canvas already share that one definition, and a third copy is how the palette drifted into an 80-degree band before. When any row is `capped`, render a caption saying the shares are a minimum.

- [ ] **Step 5: Mount it in `App.tsx`**

Fetch in an effect keyed on `selectedDate`, and render **only when `selectedCategory === null`** — a share chart on a single-section tab is a full circle saying nothing. Failure is swallowed the way the surge markers' is: the graph is readable without it.

- [ ] **Step 6: Teach the e2e mock the view**

In `e2e/support/mockSupabase.ts`, handle `daily_category_counts`, deriving the totals from the existing `COLLECTED_DATES` fixture rather than writing a second copy — a drifted copy would describe a day that does not exist. Remember that a default varying by request must be a function *and* be called by `resolve()`; returning the function serialises to `undefined`, which reaches the app as an empty result and reads exactly like "no data".

- [ ] **Step 7: Assert the key agrees with the canvas**

In `e2e/keywordGraph.spec.ts`, extend the existing tab-colour assertion: the donut arc for a section must resolve to the same `rgb()` as that section's tab dot and its words. A key naming a different green from the one on screen is worse than no key.

- [ ] **Step 8: Run everything**

```bash
npx vitest run
npm run build
npm run test:e2e
```
Expected: all pass. On a fresh clone without `.env`, `smoke.spec.ts` fails 1 of 27 on a bare count mismatch — that is the known missing-environment signature, not this change. Stop any dev server started before `.env` existed; `playwright.config.ts` sets `reuseExistingServer: true` and will silently reuse it with stale variables.

- [ ] **Step 9: Commit**

```bash
git add src/components/CategoryShare.tsx src/components/CategoryShare.test.tsx \
        src/App.tsx e2e/support/mockSupabase.ts e2e/keywordGraph.spec.ts
git commit -m "Show the proportion the ranking deliberately stops showing"
```

---

### Task 15: Write down what was learnt

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the findings, not the conclusions**

Each of these is a measurement that invalidated something, which is what this file is for:

- **Collection cannot be equalised by paging deeper.** The numbers from 2026-08-04 07:00, and the consequence: balance moved to the ranking, and a deeper page is older news that would be stamped with today's date.
- **`df_balanced` and why the denominator is the word's own section distribution**, including the 폭염 hazard a single denominator would have created.
- **α is the identity inside a category tab**, so `11_category_eval.sql` is the implementation check.
- **Place gating is sieve 6 and a cut**, with what round fourteen measured and which good words it cost.
- **The render cap is a measured dimension now**, and `10_sieve_eval.sql`/`20_unlabeled.sql` no longer hardcode 70.
- **`keyword_graph` is plpgsql** because the node rule is a fixed point and a recursive CTE cannot carry a window function. The node and edge queries live in `keyword_graph_nodes`/`keyword_graph_edges` so there is still one copy.
- **The scatter's invariant**: edges are routed first and their curves are obstacles, so `crowded` cannot rise. Note that this is the same problem the old inner-ring placement failed, solved by ordering rather than by tuning.
- **Widening the container is not the "widening buys nothing" case**, and why.
- Whatever Task 8 found about the CPU budget — including "it still dies" if that is the answer.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Record the measurements, and what each of them invalidated"
```

---

## Self-review notes

- **Spec §3.4's `MAX_LIST_PAGES`** is Task 8; **§3.7's `capped`** is Task 13; **§5's four risks** are the judgement steps in Tasks 7 and 11.
- **Task 1 leaves 양산 without a `place` row**, because `on conflict do nothing` protects its `allow` entry from `0003`. It is drawn today on that entry and would keep being drawn. If round fourteen wants it gated, it needs a second row and `word_overrides` needs a compound key — out of scope here, and named in Task 1 Step 3 so it is not discovered later.
- **`keyword_graph_edges` appears first in Task 2** and is used in Tasks 2 and 5. Its signature is `(p_date date, p_category text, p_banned text[]) returns table(a text, b text, cooc int, npmi numeric)`.
- **`scatterLoose` mutates its input nodes** (`node.x`, `node.y`) and returns only the ones it could not place. `computeGraphLayout` relies on both halves of that.
