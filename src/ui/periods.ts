import { pacificToday, type Period } from "../accounting/dates";

export const rangeTabs = [
  ["month", "Last 1 month"],
  ["quarter", "Last 3 months"],
  ["half", "Last 6 months"],
  ["ytd", "Year to date"],
  ["year", "Last year"],
  ["max", "Max"],
] as const;
export type RangeTab = (typeof rangeTabs)[number][0];
export type RangeSelection = { tab: RangeTab; value: string };
export type PeriodOption = { value: string; label: string; period: Period };
const iso = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = (year: number, month: number) =>
  iso(new Date(Date.UTC(year, month - 1, 1)));
const monthEnd = (year: number, month: number) =>
  iso(new Date(Date.UTC(year, month, 0)));
const earlier = (a: string, b: string) => (a < b ? a : b);

/** Calendar arithmetic on Pacific date labels, unaffected by daylight saving. */
export function rollingPeriod(months: number, now = new Date()): Period {
  const end = pacificToday(now);
  const [year, month, day] = end.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return { start: iso(target), end };
}

export function periodOptions(
  tab: RangeTab,
  available?: Period,
  now = new Date(),
): PeriodOption[] {
  const today = pacificToday(now);
  const [year, month, day] = today.split("-").map(Number);
  const firstYear = Math.min(
    year - 1,
    Number(available?.start.slice(0, 4) ?? year),
  );
  if (tab === "max")
    return [
      {
        value: "all",
        label: "All available data",
        period: available ?? { start: today, end: today },
      },
    ];
  if (tab === "ytd" || tab === "year") {
    const result: PeriodOption[] = [];
    for (let y = tab === "year" ? year - 1 : year; y >= firstYear; y--) {
      const endDay = Math.min(day, Number(monthEnd(y, month).slice(-2)));
      result.push({
        value: String(y),
        label: String(y),
        period: {
          start: monthStart(y, 1),
          end:
            tab === "year"
              ? monthEnd(y, 12)
              : `${monthStart(y, month).slice(0, 8)}${String(endDay).padStart(2, "0")}`,
        },
      });
    }
    return result;
  }
  const size = tab === "month" ? 1 : tab === "quarter" ? 3 : 6;
  const result: PeriodOption[] = [
    {
      value: "rolling",
      label: `Last ${size} month${size === 1 ? "" : "s"} · rolling`,
      period: rollingPeriod(size, now),
    },
  ];
  const first = earlier(available?.start ?? `${year}-01-01`, `${year}-01-01`);
  const start = new Date(
    Date.UTC(year, Math.floor((month - 1) / size) * size, 1),
  );
  while (
    monthEnd(start.getUTCFullYear(), start.getUTCMonth() + size) >= first
  ) {
    const y = start.getUTCFullYear(),
      m = start.getUTCMonth() + 1;
    result.push({
      value:
        size === 1
          ? iso(start).slice(0, 7)
          : `${y}-${size === 3 ? "Q" : "H"}${Math.ceil(m / size)}`,
      label:
        size === 1
          ? start.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })
          : size === 3
            ? `Q${Math.ceil(m / size)} ${y}`
            : `H${Math.ceil(m / size)} ${y} · ${m === 1 ? "Jan–Jun" : "Jul–Dec"}`,
      period: {
        start: iso(start),
        end: earlier(monthEnd(y, m + size - 1), today),
      },
    });
    start.setUTCMonth(start.getUTCMonth() - size);
  }
  return result;
}
