import { daysApart, type Period } from "../accounting/dates";
import { eventId, type Source } from "../accounting/types";

/** Native statement evidence and manual receipts are not a Plaid polling result. */
export function polledInvestment(source: Source): boolean {
  return (
    source.kind === "investment" &&
    !source.manual &&
    !source.id.startsWith("schwab:")
  );
}

/** Merge nearby ranges so one provider batch does not repeat the same index reads. */
export function sourceWindows(sources: Source[], padding: number): Period[] {
  const shift = (date: string, days: number) =>
    new Date(Date.parse(date + "T12:00:00Z") + days * 86400000)
      .toISOString()
      .slice(0, 10);
  const ranges = sources
    .map((s) => ({
      start: shift(s.date, -padding),
      end: shift(s.date, padding),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const merged: Period[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= shift(last.end, 1))
      last.end = last.end > range.end ? last.end : range.end;
    else merged.push({ ...range });
  }
  return merged;
}

/** A three-day match can change its counterpart's uniqueness three days further. */
export function affectedSource(source: Source, changed: Source[]): boolean {
  return changed.some(
    (s) =>
      eventId(s) === eventId(source) || daysApart(s.date, source.date) <= 6,
  );
}
