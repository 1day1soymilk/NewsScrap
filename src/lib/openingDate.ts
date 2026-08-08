// src/lib/openingDate.ts
//
// Which day the app opens on when the URL does not name one.
//
// **Today, whenever today exists.** The rule this replaces opened on the newest
// day that had *filled up* — `RIPE_SHARE` (0.28) of the median of the previous
// week — and the reason it went is a measurement, not a change of mind.
// 2026-08-08 at 15:07 KST: today held 808 headlines, a `df >= 3` pool of 406,
// and the canvas drew **66 of its 70 words**. The rule called that unripe and
// opened on the day before, because 808 is 4% under the 862 the share worked out
// to. A reader looking at a page that would have drawn 66 words was shown
// yesterday instead.
//
// **The share was a proxy for "can the canvas fill", and it lagged the thing it
// stood for.** It was calibrated on the morning — where it was right, and where
// the real finding still stands: at 03:00 KST a day holds 198-237 headlines and
// a pool of 59-81 against a render cap of 70, so the canvas genuinely cannot
// fill, and no collection change reaches it because the news is not written yet.
// What it could not do is notice that by mid-afternoon the canvas fills long
// before the day's final total is in sight. A threshold on the day's *eventual*
// size cannot answer a question about the *current* screen.
//
// So the morning case is now handled by the only fact that is never a proxy:
// **whether today has been collected at all.** Between midnight and the day's
// first cron at 03:00 KST there is nothing to draw and the app opens on the
// newest day there is; from the first cron onward it opens on today, and the
// masthead no longer has to explain a choice the reader did not make.
//
// This is a display rule and nothing else. It never changes what a day *holds*,
// only which day the reader lands on with no `?date=` to go by, and a shared
// link always wins.

import type { CollectedDate } from './queries'

/**
 * The newest collected day — which is today as soon as today has any rows.
 *
 * `dates` is `fetchCollectedDates()`'s answer: newest first, one row per
 * collected day, with that day's headline total. **Nothing here issues a
 * request** — App already reads this view on every load for the surge
 * comparison's denominators.
 *
 * The headline counts are deliberately not read. They were the old rule's whole
 * input, and the sentence above is why they are not this one's: a count is
 * evidence about the day, and what the reader needs is evidence about the
 * screen. "Has today started" is the one question a count cannot get wrong.
 *
 * Today is the newest date the view can hold, so "today if it is there, else the
 * newest that is" reduces to the first row. Nothing is special-cased about
 * today, which is what keeps this total: it returns a date that exists whenever
 * one does, and today when the archive is empty, so no caller needs a branch for
 * "no day".
 */
export function pickOpeningDate(dates: CollectedDate[], today: string): string {
  return dates.length === 0 ? today : dates[0].date
}
