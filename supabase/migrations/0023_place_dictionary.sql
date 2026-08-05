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

-- The collector's per-section per-run cap, moved out of the Edge Function so
-- that the two things which have to agree about it can read one number. Task 8
-- re-tests the value and `daily_category_counts.capped` reports whether a
-- section hit it; a literal in each place is two copies of one fact, and the
-- second one goes stale silently the moment the first is retuned.
insert into public.scoring_weights (key, value, note) values
  ('collect_cap', 150,
   'collect-headlines: headlines scraped per section per run. Read by the Edge Function and by daily_category_counts.capped.')
on conflict (key) do update set value = excluded.value, note = excluded.note;
