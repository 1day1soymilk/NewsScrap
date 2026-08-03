-- supabase/migrations/0012_normalise_compatibility_ideographs.sql
--
-- One word, two keys — the canonical-link bug in another alphabet.
--
-- Naver's headlines use the Unicode CJK *compatibility* ideographs
-- interchangeably with the ordinary ones. They render identically and are
-- different strings, so every count in this project silently splits. Found
-- 2026-08-03 while labelling for the standalone round: `李대통령` was two words
-- in headline_nouns, 15 rows divided between them, and `李정부` two more over 3.
--
-- The five that occur in this archive:
--
--   李  U+F9E1 -> U+674E      金  U+F90A -> U+91D1
--   勞  U+F92F -> U+52DE      盧  U+F933 -> U+76E7
--   女  U+F981 -> U+5973
--
-- NFC has these as canonical decompositions, so `normalize(…, nfc)` folds each
-- compatibility form onto its ordinary one and leaves every other character
-- alone. It is not NFKC: that would also rewrite ￦, ①, ㈜ and the halfwidth
-- forms Naver headlines genuinely use, which are different characters rather
-- than two spellings of one.
--
-- Both columns are rewritten, and it has to be both. keyword_signals' `standalone`
-- signal matches the word against the title with a regex — normalising the word
-- while leaving the title in the old form would make every affected word score
-- 0.00 and be cut as a fragment, which is the opposite of the intent.
--
-- The scraper stopped producing either form at the same time: `extractHeadlines`
-- normalises the title (which is also what is handed to ETRI) and `filterNouns`
-- normalises the word. This migration only repairs what is already stored.
--
-- Measured before applying, on 3,634 headlines and 23,012 noun rows:
--
--   54 titles and 15 noun rows are not NFC; 6 distinct word forms.
--   headline_nouns has no unique constraint over (headline_id, word) — only a
--   primary key on id — so no row can collide. It was checked anyway: the number
--   of (headline_id, word) groups holding more than one row is 204 before and
--   204 after, so the fold creates no duplicate. Those 204 predate this and are
--   why keyword_signals selects distinct.

update headlines
   set title = normalize(title, nfc)
 where title <> normalize(title, nfc);

update headline_nouns
   set word = normalize(word, nfc)
 where word <> normalize(word, nfc);

-- Must both be 0 afterwards. The second is the one that matters: it is the
-- query in CLAUDE.md, and it names any word stored under two spellings.
do $$
declare
  bad_titles int;
  split_words int;
begin
  select count(*) into bad_titles
    from headlines where title <> normalize(title, nfc);

  select count(*) into split_words from (
    select normalize(word, nfc)
      from (select distinct word from headline_nouns) t
     group by 1 having count(*) > 1
  ) d;

  if bad_titles <> 0 or split_words <> 0 then
    raise exception
      'normalisation incomplete: % titles not NFC, % words under two spellings',
      bad_titles, split_words;
  end if;
end $$;
