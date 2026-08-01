-- scripts/analysis/06_labels_category.sql
--
-- Labels for the 28 words that only reach the screen once sieve 1 is measured
-- per category rather than per day (11_category_eval.sql, variants 1, 3 and 4).
--
-- These are the words the category question is actually about: a word in three
-- of the day's headlines split across two sections sits deep in the day-wide
-- ranking and never enters its top 70, but it can be third in its own section.
--
-- Variant 2 (scoped df >= 2) needs 180 more and is not labelled here — see
-- README.md.
--
-- Same line as 01_labels_expansion.sql.

create schema if not exists analysis;

-- People.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '김대남','노소영','유시민','장동혁','조갑제'
]) w on conflict (word) do update set label = excluded.label;

-- Places, companies, products, markets.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '포스코','샌디에이고','튀르키예',
  -- "'휴머노이드 1위' 유니트리, IPO 초읽기"
  '유니트리',
  -- "[AI는 지금] LG, 더 크게 진화한 'K-엑사원'" — LG's model, not a common noun.
  '엑사원',
  -- Named market, the same case as 코스피.
  '뉴욕증시'
]) w on conflict (word) do update set label = excluded.label;

-- Named events. The 파업/기소 line: common nouns that say what happened.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '필리버스터',
  -- "[날씨] 초열대야 수준 밤 더위" — names the heatwave story, as 폭염 does.
  '초열대야'
]) w on conflict (word) do update set label = excluded.label;

-- Column and section titles. Naver wraps these in brackets and they recur every
-- day regardless of the news, which is the same case as 자막뉴스 and 뉴스.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '레시피',      -- [은퇴 레시피]
  '오늘날씨',    -- [오늘날씨]
  '클로즈업'     -- [클로즈업 북한]
]) w on conflict (word) do update set label = excluded.label;

-- Calendar and reporting periods.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['2분기','하반기']) w
on conflict (word) do update set label = excluded.label;

-- Standing institutions, the same case as 국회, 정부 and 대통령.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['청와대']) w
on conflict (word) do update set label = excluded.label;

-- Generic nouns and market jargon. 짜장면 heads its story but is no more a
-- keyword than 커피 is, and 피크아웃 could lead any week's market copy.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '다이어트','반대표','완승','인사','짜장면','파탄','피크아웃','후폭풍',
  -- standalone 0.33 — a piece of 날벼락.
  '벼락'
]) w on conflict (word) do update set label = excluded.label;

select label, count(*) from analysis.word_labels group by label order by label;
