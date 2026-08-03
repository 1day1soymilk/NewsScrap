-- scripts/analysis/14_labels_after_reanalysis.sql
--
-- Rule 4 firing for the sixth time, and for a cause it has not had before:
-- **the analyser changed.** ETRI's WiseNLU was replaced by garu-ko running
-- inside the Edge Function, and every noun row in the archive was re-derived
-- from the titles (scripts/reanalyze/). The sieve was not touched, the sweep
-- was not widened and no day was added — the words underneath simply are not
-- the same words, so `20_unlabeled.sql` returned 38 of them.
--
-- The line is the one the README calls unsettled and re-draws every round: a
-- word is good when it names a particular person, organisation, place or event,
-- and bad when it names a role, a category or a quantity that would read the
-- same in any week's news. **Eight of the 38 are genuinely arguable** and are
-- marked; two more were reversed while writing this, on evidence rather than on
-- reflection, and those two are the interesting ones — see the last group.
--
--   scripts/analysis/run.sh scripts/analysis/14_labels_after_reanalysis.sql

-- Organisations. Not arguable, and 국민의힘 least of all: 민주당 has been good
-- since the first label set and this is the other party.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['국민의힘', 'SK실트론', 'LG화학']) w
on conflict (word) do update set label = excluded.label;

-- 한화에어로 is the press abbreviation of 한화에어로스페이스, which the archive
-- also holds truncated one syllable shorter as 한화에어 — labelled bad, and
-- rightly, because that one is what the `standalone` cut catches as a fragment.
-- The distinction is that headlines write 한화에어로 on purpose and never write
-- 한화에어, so this is the company's name and that one is a piece of it.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'arguable: an abbreviation, but the one headlines actually use; cf 한화에어 bad'
from unnest(array['한화에어로']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- Named subjects of dated stories. 알뜰폰 is the case worth stating: 알뜰 is
-- already labelled bad with the note "알뜰폰", meaning it was only ever a
-- fragment of this word, and now that the whole word reaches the screen it
-- takes 반도체's place in the argument — a sector is good when one dated story
-- is about it. 돌려차기 is the 부산 case, not the kick.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['알뜰폰', '돌려차기', '안심옵션']) w
on conflict (word) do update set label = excluded.label;

-- Instruments and measures. All of these follow 거부권 and 보완수사권: the thing
-- one dated fight is about rather than the power in general. 특별감찰관 is the
-- sharpest — 감찰 and 특별감찰 are both bad, as fragments and as the activity in
-- the abstract, while this names the office a dated appointment fight is over.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'arguable: follows 거부권 — the instrument one dated fight is about'
from unnest(array['특별감찰관', '검찰개혁', '출국정지', '무장해제', '공중호위']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- 인터넷은행 follows 반도체: a sector one dated licensing story is about.
-- 6인방 names a particular six ("민생실패 6인방"), not a count of people.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'arguable: a category word doing a name''s job in one dated story'
from unnest(array['인터넷은행', '6인방']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- Role nouns. The family 대통령, 의원, 경찰관, 범죄자, 이용자, 피해자, 테러범
-- already sits in: these name who someone is, never what happened. 춘천시의원
-- is a title with a place on it, and both halves are separately bad already.
-- 경제라인 is a set of roles, which is the same thing counted.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['변호사', '사업자', '춘천시의원', '경제라인']) w
on conflict (word) do update set label = excluded.label;

-- Demographic categories. 중국인 follows 외국인, which is already bad, and
-- Z세대 and 관광객 are the same move by generation and by activity.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['중국인', 'Z세대', '관광객']) w
on conflict (word) do update set label = excluded.label;

-- Quantities and periods a story reports rather than is about — the 상한가,
-- 출하량, 영업익, 지지율 family. 37구 is a body count, 10조 a sum, 3분기 a
-- quarter, 성과급 a line on a payslip. 경남권 is 수도권 with a different region
-- in it. 불기둥 is market slang for a surge, so it is 상한가 in costume.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['37구', '10조', '3분기', '성과급', '경남권', '불기둥']) w
on conflict (word) do update set label = excluded.label;

-- Generic abstractions and qualifiers — 가능성, 시험대, 승부수, 막바지, 무방비.
-- 본격화 is the clearest: it says a thing is now under way and nothing about
-- which thing. 휴가철 is a season, 뉴노멀 a cliché, and 청문회 recurs whenever
-- anyone is confirmed (청문 is already bad for the same reason).
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['본격화', '휴가철', '뉴노멀', '청문회']) w
on conflict (word) do update set label = excluded.label;

-- Ordinary objects that happen to recur. None of them names the story: 놀이터
-- and 회삿돈 and 손하트 are where or with what, 본계약 is a stage every deal
-- passes through, 염색체 is a thing biology has.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['놀이터', '회삿돈', '손하트', '본계약', '염색체']) w
on conflict (word) do update set label = excluded.label;

-- **The two reversals, and they were settled by reading the headlines rather
-- than by thinking harder.** Both looked like names of particular things and
-- both are column furniture: every headline carrying 주末머니 ends in the tag
-- [주末머니], and every one carrying Y녹취록 ends in [Y녹취록]. They are the
-- newspaper's own section labels, exactly as 북리뷰 is, and a section label is
-- attached to the story rather than part of it. Y녹취록 had been written down
-- as good on the reading that it named one recording in one case; it names a
-- standing column at YTN.
--
-- Worth keeping as a habit: a word whose `spec` is 1.00 and whose headlines all
-- share a bracketed suffix is a section, not a subject.
insert into analysis.word_labels (word, label, note)
select w, 'bad', 'section tag in brackets, like 북리뷰 — not part of any story'
from unnest(array['주末머니', 'Y녹취록']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

select label, count(*) as n
from analysis.word_labels
where word in (
  '국민의힘','SK실트론','LG화학','한화에어로','알뜰폰','돌려차기','안심옵션',
  '특별감찰관','검찰개혁','출국정지','무장해제','공중호위','인터넷은행','6인방',
  '변호사','사업자','춘천시의원','경제라인','중국인','Z세대','관광객',
  '37구','10조','3분기','성과급','경남권','불기둥',
  '본격화','휴가철','뉴노멀','청문회','놀이터','회삿돈','손하트','본계약','염색체',
  '주末머니','Y녹취록'
)
group by label order by label;
