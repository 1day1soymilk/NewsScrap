-- 0016: store the part of speech the analyser assigned to each noun.
--
-- **Why this is worth a column.** CLAUDE.md records that the length clause is
-- effectively the whole sieve — `min_word_len` 3 admits 68 of the 70 drawn
-- words and its precision is the sieve's — and that none of the other signals
-- separates the good words inside that group from the bad. It also records the
-- cost of the clause, which nobody had priced: **a two-character word cannot
-- reach the screen at all** unless `word_overrides` rescues it by hand, and
-- 폭염 and 양산 are the only two that ever have been. 이란, 중국, 미국, 북한,
-- 삼성 and every two-syllable place and company name are cut with the noise.
--
-- Length was always a proxy. What the clause wants to know is whether the string
-- is a word in its own right rather than a piece of one, and the analyser
-- answers that directly now that it runs in-process: garu tags 이란 NNP and
-- 감찰 NNG. **감찰, 윤리, 청문, 초등 and 순회 are precisely the five words
-- CLAUDE.md names as the reason the specificity clause had to be disabled** —
-- they all score a perfect 1.00 on spec, and they are all NNG. The signal spec
-- could not provide is sitting in the tagger's output.
--
-- **This migration changes no behaviour**, deliberately, the same way 0014 did:
-- it adds a nullable column and nothing reads it. `keyword_signals` is untouched
-- here, no threshold in `scoring_weights` mentions pos, and `keyword_graph`'s
-- sieve is unchanged, so the drawn 70 must come back byte-identical on all four
-- labelled days. Whether a clause is worth adding is `10_sieve_eval.sql`'s
-- decision, not this file's — the rule this repository has already broken five
-- times.
--
-- Nullable rather than `not null default 'NNG'`: a default would assert a tag
-- for every row written before the analyser reported one, and "we do not know"
-- is the honest value for those. `scripts/reanalyze/` fills the archive; the
-- Edge Function fills new rows.

alter table public.headline_nouns
  add column if not exists pos text;

comment on column public.headline_nouns.pos is
  'Part of speech from the analyser, head-final for a merged compound: SK/SL + '
  '하이닉스/NNP is NNP. Null means the row predates the column.';

-- The sieve asks one question of this column — "is this a proper noun" — over
-- a day's rows for one word, so the index that serves it is on the word.
-- headline_nouns already indexes headline_id for the joins.
create index if not exists headline_nouns_word_pos_idx
  on public.headline_nouns (word, pos);
