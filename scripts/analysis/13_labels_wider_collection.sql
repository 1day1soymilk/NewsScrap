-- scripts/analysis/13_labels_wider_collection.sql
--
-- Rule 4 firing for the fifth time, and for the reason CLAUDE.md warns about
-- rather than the obvious one: **the data moved, not the sweep.** The collector
-- went from one cron run a day to four, and 2026-08-03 went from 900 headlines
-- to 2,197 in an afternoon. More headlines means more words clear
-- `min_headlines`, which means words that had never been near the top 70 are
-- suddenly on screen — 15 of them, all on that one day.
--
-- Nothing about the sieve changed. `20_unlabeled.sql` returned these anyway,
-- which is exactly what it is for.
--
-- The line these are labelled against is the one the README calls unsettled and
-- says recurs at every round: a word is good when it names a particular person,
-- organisation, place or event, and bad when it names a role, a category or a
-- quantity that would read the same in any week's news. **Four of the fifteen
-- are genuinely arguable** and are marked below; the last round reversed five
-- calls of exactly this kind on review, and doing so moved the percentages and
-- not the ranking.

-- Names. Not arguable: a person, a company, a bank.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['강선우', '쌍방울', '모건스탠리']) w
on conflict (word) do update set label = excluded.label;

-- Role nouns. The line migration 0013 drew for 이용자 and 피해자, and the same
-- one 사망자, 외국인, 투표자 and 테러범 already sit on: these name who someone is,
-- never what happened. 1군단장 and 수사팀장 are titles, which is the same thing
-- with a rank attached.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['경찰관', '범죄자', '1군단장', '수사팀장']) w
on conflict (word) do update set label = excluded.label;

-- Category nouns and quantities. 컴퓨팅센터 follows 데이터센터, 영업익 follows
-- 출하량 and 변동성, 지지율 follows 상한가 — each is a number a story reports
-- rather than the story. 부작용 is the generic abstraction family: 가능성,
-- 시험대, 승부수.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['컴퓨팅센터', '영업익', '지지율', '부작용']) w
on conflict (word) do update set label = excluded.label;

-- ARGUABLE (1/4): 거부권. A veto is an instrument rather than an event, which
-- would make it bad — but it is the instrument a particular fight is about, and
-- 특검, 필리버스터 and 긴급조치권 are all labelled good on that reasoning. Good.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'arguable: instrument, but follows 특검/필리버스터/긴급조치권'
from unnest(array['거부권']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- ARGUABLE (2/4): 보완수사권. Follows 수사권 and 보완수사, both already bad.
-- More specific than either, which is the argument for good; still the name of
-- a power rather than of a thing that happened, which is the argument that wins.
insert into analysis.word_labels (word, label, note)
select w, 'bad', 'arguable: more specific than 수사권/보완수사, but still a power not an event'
from unnest(array['보완수사권']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- ARGUABLE (3/4): 순환인사. A reshuffle is a thing that happened on a day, the
-- way 순회경선 is; against that, it is also a routine that recurs every year.
-- Good, on the 순회경선 precedent.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'arguable: recurs annually, but names one event — follows 순회경선'
from unnest(array['순환인사']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- ARGUABLE (4/4): 직무배제. An action taken against a named person on a named
-- day, which is the 구속 / 기소 / 임단협 case. Good.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'arguable: follows 구속/기소 — an action taken, not a category'
from unnest(array['직무배제']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

select label, count(*) from analysis.word_labels group by label order by label;
