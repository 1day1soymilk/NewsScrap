-- scripts/analysis/03_labels_wide_sweep.sql
--
-- Labels for the 68 words that only appear on screen once the sweep in
-- 02_sieve_configs.sql widens — turning the specificity or length clause off, or
-- dropping min_headlines to 2, promotes words that no narrower configuration
-- ever showed. Rule 2 (sweep wide) and rule 4 (label everything shown) pull in
-- the same direction here: widening the sweep is what exposed them.
--
-- Same line as 01_labels_expansion.sql.

create schema if not exists analysis;

-- People.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '이재명','구자현','송영길','신장식','정성호','젤렌스키','최민희'
]) w on conflict (word) do update set label = excluded.label;

-- Places and countries.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '강남','제주','이탈리아','폴란드','브라질','가자지구'
]) w on conflict (word) do update set label = excluded.label;

-- Organisations and companies.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '현대차','엔비디아','키옥시아','가비아','선관위'
]) w on conflict (word) do update set label = excluded.label;

-- Concrete events.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '임단협'
]) w on conflict (word) do update set label = excluded.label;

-- Market and business boilerplate.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '종목','폭락','하락','상장','폭등장','버블','슈퍼사이클','삼전','목표','요금',
  '설비','방산','배터리','바이오','빅테크','에너지','모바일','로봇','드론',
  '오피스텔','유튜버','대표','사장','신입','오픈'
]) w on conflict (word) do update set label = excluded.label;

-- Generic abstract nouns.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '추가','회의','작전','절반','난동','봉쇄','민심','범죄','살인','남성','수학',
  '음식','에어컨','여름','경계','모스'
]) w on conflict (word) do update set label = excluded.label;

-- Fragments — every one scores at or near 0.00 on standalone: 가짜 (가짜뉴스),
-- 윤리 (윤리위), 청문 (청문회), 초등 (초등학교), 순회, 외국, 거리, 사법 0.40.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '가짜','윤리','청문','초등','순회','외국','거리','사법'
]) w on conflict (word) do update set label = excluded.label;

-- Open question, deliberately left visible rather than settled quietly:
-- 파업, 구속, 기소 and 임단협 are all labelled good as concrete events, but they
-- recur across days the same way 경찰 and 수사 do — the reason those two were
-- moved to bad. Either the line is "proper nouns and named phenomena only",
-- which would demote all four, or it is "concrete events count", which would
-- readmit 경찰. The sieve's chosen thresholds barely move either way, but the
-- absolute precision figures do, so this is worth settling before the numbers
-- get quoted anywhere.

select label, count(*) from analysis.word_labels group by label order by label;
