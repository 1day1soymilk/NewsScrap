-- scripts/analysis/05_labels_second_collection.sql
--
-- Labels for the 54 words that appeared when 2026-08-01 was collected a second
-- time. The plan's Phase 0 predicted this: the manual run and the 13:00 KST cron
-- both fire on the same date, and the 150-per-category cap applies per run, so
-- the day went from 873 headlines to 1,382. New headlines bring new words, and
-- rule 4 says they must be labelled before the harness means anything.
--
-- Fourth time the worklist has come back non-empty, and the first time the cause
-- was the data moving rather than the sweep widening.
--
-- Same line as 01_labels_expansion.sql: a proper noun, or a common noun that
-- pins a specific story, is good. A common noun that could carry any week's news
-- is bad, which is why 검찰, 수사, 정부 and 대통령 are already bad while 구속,
-- 기소 and 파업 are good.

create schema if not exists analysis;

-- People.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '윤한홍','김건희',
  -- "워시, 1년에 8회 개최하는 연준 FOMC 회의 축소 검토" — a Fed figure, not a verb.
  '워시'
]) w on conflict (word) do update set label = excluded.label;

-- Places, organisations, companies.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '경산',
  -- "T1, 젠지 홈에 '찬물'" — the esports team, not the generation.
  '젠지',
  -- Evidence the Phase 1 compound merge works: this arrived as bare 하이닉스
  -- before, with SK dropped.
  'SK하이닉스'
]) w on conflict (word) do update set label = excluded.label;

-- Named events, laws and policies. These are the 구속/기소/파업 line: common
-- nouns, but ones that say what happened.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '특검','종합특검','공소기각','형소법','대선','총선','방화','보이콧','귀화',
  -- "기간제 4년·52시간 예외 '반노동 메가특구법' 파장"
  '메가특구',
  -- "미·이, 주말 이란 에너지시설 공습 계획"
  '에너지시설',
  -- "'보호 야생생물' 새끼 까마귀 잡아 기른 40대女"
  '까마귀',
  '난임'
]) w on conflict (word) do update set label = excluded.label;

-- Fragments. Each is a piece of a compound that ETRI split and the merge did not
-- rejoin, and the standalone signal says so outright.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  -- 0.00 — only ever occurs inside 유조선.
  '유조',
  -- 0.17 — "애플의 승부수".
  '승부',
  -- 0.08 — 투표율, 사전투표.
  '투표',
  -- 0.29, and 수사 is already bad.
  '보완수사'
]) w on conflict (word) do update set label = excluded.label;

-- Institutions and roles that recur every day, the same case as 정부 and 대통령.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['국회','측근','공천','개정안']) w
on conflict (word) do update set label = excluded.label;

-- Site furniture and calendar words.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['자막뉴스','인터뷰','나흘','작년']) w
on conflict (word) do update set label = excluded.label;

-- Generic nouns. Concrete enough to head a sentence, empty enough to head any
-- day's. 새끼 and 공주 look specific but are not: both are modifiers inside
-- someone else's story ("새끼 까마귀", "'어둠의 공주' 모금책").
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '계획','여성','변수','세상','선언','추락','새끼','부동산','수정','시신','이혼',
  '직장','결혼','고조','공주','보험','유일','재미','저주','커피','폐쇄','호응','냄새'
]) w on conflict (word) do update set label = excluded.label;

select label, count(*) from analysis.word_labels group by label order by label;
