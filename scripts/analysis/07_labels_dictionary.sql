-- scripts/analysis/07_labels_dictionary.sql
--
-- Labels for the 7 words that the 0005 dictionary additions promoted onto the
-- screen. Rule 4 again, and this time triggered by the dictionary rather than by
-- the sweep or by a new collection: removing 26 words from the top 70 pulls 7
-- deeper ones up to fill the gap, and until they are labelled the harness is
-- measuring a fraction of the screen.
--
-- All seven are bad, which is worth stating plainly rather than presenting the
-- exclusions as a clean win: the dictionary removed 26 bad words and the screen
-- refilled with 7 more. The gain is real but smaller than the count of entries
-- suggests, and this is the mechanism README.md rule 4 exists to expose.
--
-- Same line as 01_labels_expansion.sql.

create schema if not exists analysis;

-- Compound fragments. Both give themselves away on the standalone signal and on
-- their headlines: "지구대 주취 난동" and "김지숙 춘천시의원".
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['지구', '춘천시']) w
on conflict (word) do update set label = excluded.label;

-- Institution, the same case as 국회 and 청와대.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['대법']) w
on conflict (word) do update set label = excluded.label;

-- Generic nouns.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['전망', '참여', '취소']) w
on conflict (word) do update set label = excluded.label;

-- 교전 is the arguable one and goes bad for consistency: 공습 is already bad,
-- and "교전 격화" is the same kind of word about the same story. Whether that
-- line is in the right place is the open question the label set keeps running
-- into — 파업, 구속 and 기소 are good on the grounds that they name concrete
-- events, which is arguably the same case. Moving the line moves the absolute
-- percentages but not which configuration wins.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['교전']) w
on conflict (word) do update set label = excluded.label;

select label, count(*) from analysis.word_labels group by label order by label;
