-- scripts/analysis/22_labels_after_demotion_fix.sql
--
-- Rule 4, fired by a **harness fix** rather than by a data or configuration
-- change — a cause it has not had before.
--
-- `11_category_eval.sql` and `21_unlabeled_category.sql` ranked by `df desc,
-- word` while `keyword_graph` ranks by the head_pos demotion first. That
-- disagreement was invisible for as long as the standing claim held that a
-- category tab never fills the render cap, because a reordering that changes
-- nothing about which words survive cannot change what is drawn. **The claim is
-- false on a fat day**: 2026-08-03 puts 95 to 163 qualifying words on every one
-- of its six tabs against a cap of 70, and 2026-08-01's society tab 77. Seven of
-- the 24 cells bind.
--
-- So on those seven the harness had been scoring a screen the app does not draw.
-- Modelling the demotion promotes 14 words that had never been measured.
--
--   scripts/analysis/run.sh scripts/analysis/22_labels_after_demotion_fix.sql

-- People. 조국 is the politician, not the common noun — it sits at spec 1.00 in
-- politics. 젠슨 is the distinctive half of 젠슨 황, the same case as 칼라스 in
-- 마리아 칼라스: the eojeol rule splits a two-word name and both halves are the
-- person.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['김성태', '조국', '천하람', '젠슨']) w
on conflict (word) do update set label = excluded.label;

-- A country, and an organisation. 금융위 is 금융위원회 as headlines write it.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['태국', '인도', '금융위']) w
on conflict (word) do update set label = excluded.label;

-- Regions as backdrop — 수도권, 호남, 경남권, 중동's family.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['영남', '강북']) w
on conflict (word) do update set label = excluded.label;

-- Market vocabulary a story reports rather than is about — 상한가, 출하량,
-- 반도체주's family. 차익실현 scores `standalone` 0.00 as well, so it is a
-- fragment on top of being generic.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['주식시장', '차익실현', '韓증시']) w
on conflict (word) do update set label = excluded.label;

-- 헤드라인 is the newspaper's word for its own furniture, 북리뷰's family.
-- 액트 is an English loan doing no work on its own.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['헤드라인', '액트']) w
on conflict (word) do update set label = excluded.label;


-- ---------------------------------------------------------------------------
-- A second pass, from the `min_word_len` 4 sweep. Raising the length bar frees
-- places on the seven cells where the cap binds, so it promotes too — the same
-- mechanism, a different trigger.
-- ---------------------------------------------------------------------------

-- People, a capital, the law the 형소법 story is about, a company.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['추미애', '한병도', '평양', '형사소송법', '에스하이텍']) w
on conflict (word) do update set label = excluded.label;

-- Legal and market procedure — 압수수색, 명예훼손, 유상증자's family: each
-- happens somewhere every week, however particular the case behind it.
-- 레버리지ETF follows 레버리지, already excluded.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '직권남용', '헌법소원', '흑자전환', '레버리지ETF', '안전장치'
]) w on conflict (word) do update set label = excluded.label;

-- 와르르 is onomatopoeia and 사라 is the stem of 사라지다 caught as a noun.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['와르르', '사라']) w
on conflict (word) do update set label = excluded.label;

select
  (select count(*) from analysis.word_labels) as labels_total,
  (select count(*) from analysis.word_labels where label = 'good') as good,
  (select count(*) from analysis.word_labels where label = 'bad') as bad;
