-- scripts/analysis/08_labels_after_dedup.sql
--
-- Eight words 20_unlabeled.sql found after the data moved, not after the sweep
-- widened. That is the second half of rule 4 and it fired here exactly as
-- README.md warns: 02_sieve_configs.sql was not touched, but migration 0007
-- collapsed the archive onto one row per article and 0008 removed four words
-- from the dictionary, and between them the ranks near every configuration's
-- cut are filled by different words now.
--
-- All eight go bad, and they go bad for reasons the label set has already used:
--
--   발견, 돌파, 회복  generic nouns, the same case as 전망, 참여 and 취소 in 07.
--   바다, 해상        generic locatives. 해상 also scores 0.25 standalone —
--                     it arrives as a piece of 해상풍력 and 해상초계기.
--   관저              an institution, the same case as 청와대 and 대법.
--   수출, 금융        domain names rather than events, the same case as
--                     바이오 and 클라우드.
--
-- 수출 is the arguable one. It is a real subject and a headline can be about
-- nothing else, which is the argument that made 파업 and 기소 good. It goes bad
-- because those name something that happened on the day and 수출 names a
-- standing category that recurs whatever the news — the same distinction that
-- put 부동산 and 배터리 on the bad side. This is the open question the label set
-- keeps running into, and as ever it moves the absolute percentages without
-- moving which configuration wins.

insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['발견', '돌파', '회복']) w
on conflict (word) do update set label = excluded.label;

insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['바다', '해상']) w
on conflict (word) do update set label = excluded.label;

insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['관저']) w
on conflict (word) do update set label = excluded.label;

insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['수출', '금융']) w
on conflict (word) do update set label = excluded.label;

select label, count(*) from analysis.word_labels group by label order by label;
