-- scripts/analysis/17_labels_two_character.sql
--
-- Rule 4 for round nine. `16_proper_noun_configs.sql` put two-character words on
-- screen for the first time in this project's history — `min_word_len` has been
-- 3 since the beginning, and the only two-character words ever drawn were 폭염
-- and 양산, both by hand through `word_overrides`. So `20_unlabeled.sql`
-- returned 44 words that are, almost without exception, two characters long.
--
-- **Most of them come from configuration 131, not from the one under test.** 131
-- is `min_word_len 2` — admit every two-character word — and it is in the sweep
-- precisely so the tagger has something to beat. It is what drags 급락, 세계,
-- 국가, 위기, 이번 and 사람 onto the list.
--
--   scripts/analysis/run.sh scripts/analysis/17_labels_two_character.sql

-- Places where the story happened. Same line as 왕십리역 and 보릿돌교 in round
-- eight, and the same contrast with 아시아 / 동남아 / 중남미: 대구 is where the
-- record 40.9° was measured, 해남 is where the national AI centre broke ground.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['대구', '부산', '인천', '대전', '해남']) w
on conflict (word) do update set label = excluded.label;

-- A state, a company, a named community. 북한 is an actor rather than a region —
-- the distinction from 중동 and 남미 and 호남 below, which are backdrop.
-- 일베 is the site in '일베 침투설'; 기아 is the carmaker.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['북한', '기아', '일베']) w
on conflict (word) do update set label = excluded.label;

-- Regions as backdrop — 수도권, 경남권, 아시아, 동남아, 중남미's family.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['유럽', '남미', '중동', '호남', '세계', '서쪽', '국내']) w
on conflict (word) do update set label = excluded.label;

-- **Two-character fragments, which are the honest reason the length clause was
-- ever set at 3.** 닉스 is 삼전닉스 cut at the second syllable and scores
-- `standalone` 0.14; 입구 reaches the screen only through 해협 입구; 어스 is the
-- generic half of 구글 어스, and unlike 마리아/칼라스 — where both halves are a
-- name — the distinctive half is the other one. 자진 is 자진 탈당.
insert into analysis.word_labels (word, label, note)
select w, 'bad', 'two-character fragment: the case min_word_len 3 exists for'
from unnest(array['닉스', '입구', '어스', '자진']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- Acts and events that any other week would also print — the operational form
-- of the line, as round eight settled it. A resignation, a state visit, a
-- shooting, an explosion and a collision happen somewhere every week; that this
-- archive can point at the particular one is not the test.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '탈당', '순방', '피격', '침투', '폭발', '충돌', '반발', '급락', '공방', '멱살'
]) w on conflict (word) do update set label = excluded.label;

-- Generic abstractions, quantities and time words — 가능성, 시험대, 막바지,
-- 상한가's families, now in their two-character form. This group is what a
-- blunt `min_word_len 2` buys, and it is why the tagger is worth asking.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '국가', '위기', '이번', '개발', '첫날', '사람', '고향', '최악', '노사', '시대',
  '가격', '박빙', '병실', '사태', '엔화'
]) w on conflict (word) do update set label = excluded.label;

select
  (select count(*) from analysis.word_labels) as labels_total,
  (select count(*) from analysis.word_labels where label = 'good') as good,
  (select count(*) from analysis.word_labels where label = 'bad') as bad;
