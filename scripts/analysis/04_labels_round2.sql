-- scripts/analysis/04_labels_round2.sql
--
-- Labels for the 27 words that only surfaced once the round-two configurations
-- (specificity clause off) entered the sweep. Third time this has happened, and
-- it is the expected rhythm rather than a surprise: widening the sweep promotes
-- deeper-ranked words onto the screen, and rule 4 says they must be labelled
-- before the run counts. Re-run 20_unlabeled.sql after any change to
-- 02_sieve_configs.sql.
--
-- Same line as 01_labels_expansion.sql.

create schema if not exists analysis;

-- People.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['박성재']) w
on conflict (word) do update set label = excluded.label;

-- Places and countries.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '일본','쿠웨이트','헝가리','실리콘밸리','해운대','월가'
]) w on conflict (word) do update set label = excluded.label;

-- Organisations, companies, brands.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '두산','네이버','래블업','에코프로비엠','차바이오텍','일본은행','스트래티지',
  '제미나이','비트코인'
]) w on conflict (word) do update set label = excluded.label;

-- Generic nouns and business boilerplate.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '환자','공유','반성','속출','심장','총재','박탈','출하','평균','플러스','로보틱스'
]) w on conflict (word) do update set label = excluded.label;

select label, count(*) from analysis.word_labels group by label order by label;

-- Round three surfaced three more once standalone and the neighbour cut were
-- swept past their round-two range.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['상하이','순천대']) w
on conflict (word) do update set label = excluded.label;

insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['폴더블']) w
on conflict (word) do update set label = excluded.label;
