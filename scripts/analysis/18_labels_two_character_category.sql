-- scripts/analysis/18_labels_two_character_category.sql
--
-- Rule 4 for round nine's category half. With `min_proper` at 1.00 the tabs
-- promote 36 words, and **31 of them are names** — 포항, 울산, 통영, 경주, 원주,
-- 고양, 제천, 광양, 경북, 강원, 전남, 충남, 광주, 한강; 독일, 칠레, 가자, 뉴욕,
-- 유엔, 오만, 미일; 인텔, 쿠팡, 퀄컴, 한화, 축협, 키미; 김용, 놀런, 룰라, 타코.
--
-- That ratio is the measurement, not the labels. The day-wide list from
-- `17_labels_two_character.sql` was 8 good out of 44 because configuration 131
-- (`min_word_len 2`, admit everything two characters long) was in the sweep;
-- this list is what the **tagger** admits, and the difference between 8-in-44
-- and 31-in-36 is the whole case for the clause.
--
--   scripts/analysis/run.sh scripts/analysis/18_labels_two_character_category.sql

-- Korean places where a story happened.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '포항', '울산', '통영', '경주', '원주', '고양', '제천', '광양', '광주',
  '경북', '강원', '전남', '충남', '한강'
]) w on conflict (word) do update set label = excluded.label;

-- States, capitals and bodies. 미일 names two governments acting together, the
-- way 한미 would; 유엔 and 축협 are organisations; 가자 is where the war is.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '독일', '칠레', '가자', '뉴욕', '유엔', '미일', '축협'
]) w on conflict (word) do update set label = excluded.label;

-- **오만 is worth its own entry, because it is `standalone`'s documented blind
-- spot arriving in the data.** It scores 0.00 — the signal's fragment score —
-- for the reason CLAUDE.md already records and measured as harmless: Korean
-- attaches 조사 without a space, and every one of its headlines writes 오만과.
-- It is the country, in the Hormuz story. The clause under test admits it
-- because the analyser tags it NNP, which is the tagger disagreeing with
-- `standalone` and being right.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'country; standalone 0.00 is the 조사 blind spot (오만과), not a fragment'
from unnest(array['오만']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- Companies, products and people.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '인텔', '쿠팡', '퀄컴', '한화', '키미', '김용', '놀런', '룰라', '타코'
]) w on conflict (word) do update set label = excluded.label;

-- The five the clause admits that it should not. 비아 is 가비아 cut at the first
-- syllable and scores `standalone` 0.00 for the honest reason rather than 오만's;
-- 수유 is an act, 1조 a sum, 직격 and 잭팟 the qualifier family.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['비아', '수유', '1조', '직격', '잭팟']) w
on conflict (word) do update set label = excluded.label;

select
  (select count(*) from analysis.word_labels) as labels_total,
  (select count(*) from analysis.word_labels where label = 'good') as good,
  (select count(*) from analysis.word_labels where label = 'bad') as bad;
