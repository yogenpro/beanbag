export type Period = { start: string; end: string };
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function assertPeriod(period: Period): Period {
  if (
    !validDate(period.start) ||
    !validDate(period.end) ||
    period.start > period.end
  )
    throw new Error("Invalid date range");
  return period;
}
export function pacificToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join("-");
}
export function periodFor(preset: string, now = new Date()): Period {
  const today = pacificToday(now),
    [year, month] = today.split("-").map(Number);
  const lastDay = (y: number, m: number) =>
    new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (preset === "previous") {
    const m = month === 1 ? 12 : month - 1,
      y = month === 1 ? year - 1 : year;
    return {
      start: `${y}-${String(m).padStart(2, "0")}-01`,
      end: lastDay(y, m),
    };
  }
  if (preset === "year") return { start: `${year}-01-01`, end: today };
  if (preset === "quarter")
    return {
      start: `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`,
      end: today,
    };
  return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: today };
}
export function daysApart(a: string, b: string): number {
  return (
    Math.abs(Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) /
    86_400_000
  );
}
