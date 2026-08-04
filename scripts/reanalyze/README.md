# Re-analysing the archive

Run once, on 2026-08-04, when the morphological analyser moved from ETRI's
WiseNLU to `garu-ko` running inside the Edge Function. It re-derives every noun
row in `headline_nouns` from the titles already in `headlines`.

**What it bought is uniformity, and the archive had never had it.** Before this
the table blended three analysers: ETRI before the compound-merge fix shipped
(1,716 of 2,043 rows on the two originally labelled days), ETRI after it, and —
for a few hours on 2026-08-04 — garu. A word count that crossed 2026-08-01
13:00 KST measured two analysers at once. It now measures one.

## Running it

```bash
node --experimental-strip-types --import ./scripts/layout/register.mjs \
     scripts/reanalyze/reanalyze.mjs      # reads, analyses, writes reanalyze.sql
node scripts/reanalyze/apply.mjs          # sends it to the Management API
```

The two halves are separate files on purpose. `reanalyze.mjs` reads through
PostgREST with the **anon** key, which RLS forbids from writing at all, so the
analysis cannot damage the archive as a property of the code rather than as a
claim about it. `apply.mjs` is the only half holding a credential that can
write.

`reanalyze.sql` is git-ignored: it is 1.9MB of literals and it is reproducible
from the two scripts and the archive.

## Why a staging table

The plan for this bracketed the inserts in `begin;` and `commit;`. That does not
work here and would have been silent about it: **every Management API request is
its own session**, so a `begin` sent in one request and a `commit` sent in
another bracket nothing, and a failure among the 20 inserts in between would
have left `headline_nouns` empty with no transaction to roll back.

So the rows are accumulated in `headline_nouns_reanalysis` across as many
requests as they need — safe, because nothing reads that table — and the
exchange is a single statement, which is atomic on its own:

```sql
with cleared as (delete from public.headline_nouns returning 1)
insert into public.headline_nouns (headline_id, word)
select headline_id, word from public.headline_nouns_reanalysis;
```

The staging table is dropped by the last statement.

## What it measured

23 statements, 5,802 headlines, **35,957 noun rows before and 36,183 after** —
a difference of 0.63%. The plan's gate was 10%, on the reasoning that a bigger
gap would mean the extraction was broken rather than that the analyser was
different. It is smaller still than 0.63% suggests: 116 of today's headlines
were carrying no nouns at the time of the count, having been emptied
deliberately to test the collector's repair path, so the honest before-figure is
about 36,700 and garu returns slightly **fewer** rows than ETRI did.

After, by day:

| date | headlines | noun rows | distinct words | nouns/headline |
| --- | --- | --- | --- | --- |
| 2026-07-31 | 899 | 5,773 | 2,908 | 6.42 |
| 2026-08-01 | 1,144 | 6,913 | 3,412 | 6.04 |
| 2026-08-02 | 691 | 4,223 | 2,258 | 6.11 |
| 2026-08-03 | 2,197 | 13,832 | 5,372 | 6.30 |
| 2026-08-04 | 871 | 5,442 | 2,546 | 6.25 |

And the four checks, all of which must be what they are here:

| check | value |
| --- | --- |
| headlines with no nouns | 0 |
| words differing only by NFC form | 0 |
| articles reachable by two links | 0 |
| staging table left behind | 0 |

**These numbers say nothing about word quality.** Whether the words on screen
got better is `scripts/analysis/`'s question, and it has to be re-asked from the
labels up, because the archive moved underneath the label set — rule 4 of that
directory's README, firing for the sixth time.

## Re-running it

It is idempotent: it derives everything from `headlines`, so running it twice
gives the same table. There is no reason to, unless the analyser or
`lib/nouns.ts` changes again — in which case the sieve has to be re-scored
afterwards, and so does the layout.
