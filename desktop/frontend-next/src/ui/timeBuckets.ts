import { t } from "../i18n";

export interface TimeMarks {
  /** key → the section label of the bucket this key opens, for the keys that
   *  come first in their bucket. */
  marks: Map<string, string>;
  /** bucket label → how many rows it holds, for the header's count. */
  counts: Map<string, number>;
}

const DAY = 86400_000;

// Calendar midnight of the day `at` falls in, local time.
const startOfDay = (at: number): number => {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

// The sections the sidebar reads: today, yesterday, the week before those,
// the month before that, and one tail for everything older.
const ladder: ReadonlyArray<{ key: string; maxAgeDays: number; msg: string }> = [
  { key: "today", maxAgeDays: 0, msg: "session.bucket_today" },
  { key: "yesterday", maxAgeDays: 1, msg: "session.bucket_yesterday" },
  { key: "week", maxAgeDays: 7, msg: "session.bucket_week" },
  { key: "month", maxAgeDays: 30, msg: "session.bucket_month" },
  { key: "earlier", maxAgeDays: Infinity, msg: "session.bucket_earlier" },
];

// The section a row gathers under, by how many calendar days ago its last
// activity was. A row without a stamp is being written right now: today.
function bucketOf(at: number, now: Date): { key: string; label: string } {
  if (!(at > 0)) return { key: "today", label: t(ladder[0].msg) };
  const ageDays = Math.floor((startOfDay(now.getTime()) - startOfDay(at)) / DAY);
  for (const step of ladder) {
    if (ageDays <= step.maxAgeDays) return { key: step.key, label: t(step.msg) };
  }
  return { key: "earlier", label: t("session.bucket_earlier") };
}

/** The section one row's stamp gathers under, in the same terms the section
 *  walk below uses. The flat timeline walks its rows in render order and asks
 *  this per row, so a header can never drift from the row it opens. */
export function dayBucket(at: number): { key: string; label: string } {
  return bucketOf(at, new Date());
}

/** Given rows already ordered newest first, cut them into day sections:
 *  the key that opens each section carries its label, and every section knows
 *  how many rows it holds. Consecutive rows of one section share it; a section
 *  the rows skip never appears. */
export function monthBuckets(items: { key: string; at: number }[]): TimeMarks {
  const now = new Date();
  const ordered = [...items].sort((a, b) => (b.at || 0) - (a.at || 0));
  const marks = new Map<string, string>();
  const counts = new Map<string, number>();
  let current = "";
  let currentLabel = "";
  for (const item of ordered) {
    const { key, label } = bucketOf(item.at, now);
    if (key !== current) {
      current = key;
      currentLabel = label;
      marks.set(item.key, label);
    }
    counts.set(currentLabel, (counts.get(currentLabel) ?? 0) + 1);
  }
  return { marks, counts };
}
