# Analysing Korean in the function — design

2026-08-04. Replaces ETRI's WiseNLU HTTP API with `garu-ko`, a WebAssembly
morphological analyser running inside the Edge Function, and takes the archive
down to one analyser for the first time.

## 1. Why now

ETRI's key started answering `{"success":false,"reason":"Blocked KEY"}` on
2026-08-03 at about 16:37 KST and had not recovered by 01:35 the next morning.
Whether that is a daily quota or an administratively dead key is still open —
the 03:00 KST cron is the observation that settles it, because 23:00 falls
inside the same quota day and discriminates nothing.

**The block is the occasion, not the reason.** An external call per headline is
what shapes every constant in the collector: 500ms of round trip is why eight
run in flight, why the budget is 50 seconds, why a section stops at 150
headlines, and why a day needs six cron runs to be collected at all. And ETRI's
5,000-a-day ceiling is why the archive has never been re-analysed.

## 2. What was measured before designing anything

`garu-ko` 0.9.12 (MIT, 1.4MB WASM model) was run over the 2,197 headlines of
2026-08-03 and compared against the ETRI nouns already stored for those same
headlines.

```
2,197 headlines in 1,745ms          0.79ms each, against ~500ms per ETRI call
distinct words   ETRI 5,315         garu 5,372
noun rows        ETRI 13,640        garu 13,736      13,109 identical (96%)
top 70 by frequency                 68 of 70 identical
```

Every word this repository has reasoned about matches exactly: 반도체 32/32,
무인기 17/17, 李대통령 21/21, 보완수사권 14/14, 폭염 121/121, 양산 42/42,
1군단장 11/11, 직무배제 10/10, 순환인사 10/10.

Two words differ in the drawn set. **삼전닉스** (ETRI) becomes **닉스** — garu
splits the 삼성전자+하이닉스 portmanteau. **오늘** (ETRI) becomes **서쪽** —
garu tags 오늘 as an adverb, which drops a generic word and is an improvement
rather than a loss.

So the analyser boundary this design was expected to introduce is mostly not
there. That is what makes re-analysing the archive worth doing rather than
merely possible.

Three words come back whole from garu that ETRI split and the merge rule had to
repair: 반도체 (ETRI: 반/XPN + 도체/NNG), 무인기 (무인/NNG + 기/XSN) and
SK하이닉스 (SL + NNP).

## 3. The risk that cannot be measured here

**Nobody knows whether `garu-ko` loads under Deno**, and this environment has no
Deno, no Docker and no local Postgres to find out with. The `node` entry reads
the model and the WASM through `fs/promises`; whether Supabase's bundler ships
non-JS assets alongside the function is unknown. The `browser` entry takes a
`modelUrl` and fetches instead, which may be the path that works.

So the first step is a **probe deployment** that tries both entries and analyses
one headline, verified the way `index.ts` is always verified — by running the
deployed function and reading its response. If neither entry loads, this design
does not survive and the fallback is a new ETRI key.

## 4. Design

### 4.1 The extraction rule barely moves

`lib/nouns.ts` stops parsing `EtriResponse` and starts consuming garu's
`Token[]` — `{ text, pos, start, end }`. garu's tagset is the same Sejong
family ETRI uses, so the merge rule transfers unchanged: NNG and NNP make a run
a noun, the `J*`/`E*`/`V*`/`M*`/`I*` families and `NNB`/`XSV`/`XSA`/`S[FPSEOW]`
break a run, and `XSN` breaks only for 들 and 적.

One thing changes. **Eojeol boundaries come from the source string's whitespace
rather than from ETRI's `word` spans.** Tokens carry character offsets, so the
boundary can be read off the headline directly. This is closer to what the rule
always claimed — that the headline's own spacing says what belongs together.

`filterNouns` is untouched: NFC normalisation, the stopword set, the
two-character minimum.

**The Garu instance never enters `lib/`.** It is constructed in `index.ts` and
the library takes tokens. That keeps `lib/*.ts` runtime-agnostic as CLAUDE.md
requires, and keeps `nouns.test.ts` runnable under Vitest on Node.

### 4.2 The archive is re-analysed in full

Four days, roughly 5,000 headlines, a few seconds of work. Afterwards the
archive is the output of **one analyser** for the first time; today it spans
three ETRI eras (before the compound merge, after it, after the eojeol fix) and
the sieve harness has had to reason about those boundaries at every round.

The service-role key exists only in the Edge Function environment and RLS blocks
anon writes, so a local script cannot write to the database. Nouns are therefore
computed locally, emitted as chunked SQL, and applied through the Management
API inside a transaction. **No re-analysis path is added to the deployed
function**, which would otherwise remain in production as a destructive endpoint
long after its one use.

### 4.3 Everything downstream is re-derived

Re-analysis moves the words, so in order: `20_unlabeled.sql` (label whatever it
returns), `10_sieve_eval.sql` and `11_category_eval.sql`, then
`pullFixture.mjs` and the three layout harnesses, then the unit and e2e gates.

This is rule 4 of `scripts/analysis/README.md` firing for the reason it names —
the data moved — and it is the largest such move the archive has had.

## 5. Constants that lose their justification, and are left alone

`ANALYSIS_CONCURRENCY` (8), `RUN_BUDGET_MS` (50,000),
`MAX_HEADLINES_PER_CATEGORY` (150), `MAX_LIST_PAGES` (8) and the six cron jobs
were all sized around a 500ms round trip per headline. None of them has a reason
to be what it is once the round trip is gone.

**They are not changed in this pass.** Moving the analyser and the collection
volume together would leave no way to tell which one caused whatever the numbers
do afterwards — the same discipline that made `head_pos` ship as a demotion
rather than as a cut. Each constant gets a comment saying its justification is
gone and what should be measured next.

The comments also record what the next version is for:

- **Re-tune collection volume.** 300 headlines over 12 pages once returned
  `546 WORKER_RESOURCE_LIMIT` at 63 seconds. That wall may have been ETRI
  latency rather than the platform, in which case deeper paging now fits.
- **A collect-now button**, so a collection can be taken on demand instead of
  waiting for the next cron.
- **Filter duplicate headlines by title.** `UNIQUE (category_id, link)` and
  `canonicalLink` already stop the same article arriving twice, but the same
  story published by different outlets is not caught. 2026-08-01 holds 190 such
  rows, and duplicates inflate co-occurrence — `edge_min_cooc = 2` can be
  satisfied by one story collected twice.

## 6. Deliberately out of scope

**`addUserWord`.** garu can be taught 삼전닉스 at runtime, and `word_overrides`
already holds an `allow` list that could feed it. It is one word out of seventy,
and adding it now would mix the analyser swap's effect with a dictionary's. If
revalidation shows it matters, it is a small change to make afterwards.

**Keeping ETRI as a fallback.** Removed entirely, but only after the probe in
§3 succeeds. Until then nothing is removed.

## 7. How this is verified

The probe first — nothing else starts until the deployed function analyses a
headline. Then `nouns.test.ts` against garu tokens, `npm run build` (the real
gate, since it type-checks the function's `lib/`), the sieve harness with
`unlabeled` at 0, the three layout harnesses on a freshly pulled fixture, and
the 264 unit plus 42 e2e tests.

The collector itself is verified the only way it can be: deployed, run, and its
`summary` read.
