import { assertPeriod, validDate } from "./dates";
import { sumCents } from "./money";

export type TimeWeightedReturn = {
  status: "estimated" | "unavailable";
  rate: number | null;
  annualizedRate: number | null;
  reason:
    | "missing_balances"
    | "missing_history"
    | "unresolved_flows"
    | "missing_daily_values"
    | "non_positive_capital"
    | "no_invested_capital"
    | "invalid_values"
    | "numeric_range"
    | null;
  method: "daily_start_inflows_end_outflows";
  days: number;
  usesReconstructedValues: boolean;
};
export const unavailableReturn = (
  reason: TimeWeightedReturn["reason"],
): TimeWeightedReturn => ({
  status: "unavailable",
  rate: null,
  annualizedRate: null,
  reason,
  method: "daily_start_inflows_end_outflows",
  days: 0,
  usesReconstructedValues: false,
});
type DailyValue = { date: string; valueCents: number; reconstructed?: boolean };
type CapitalFlow = { date: string; inflowCents: number; outflowCents: number };

/** Daily-linked, nonannualized estimate. Contributions start the day; withdrawals
 * end it. In-kind transfers are capital flows too. All values are net of debt.
 * Daily factor = (ending value + outflows) / (opening value + inflows).
 */
export function dailyTimeWeightedReturn(
  values: DailyValue[],
  flows: CapitalFlow[],
  openingDate: string,
  closingDate: string,
): TimeWeightedReturn {
  assertPeriod({ start: openingDate, end: closingDate });
  const result = unavailableReturn("missing_daily_values");
  if (openingDate === closingDate) return result;
  const byDate = new Map<string, DailyValue>();
  for (const value of values.filter(
    (v) => v.date >= openingDate && v.date <= closingDate,
  )) {
    if (
      !validDate(value.date) ||
      !Number.isSafeInteger(value.valueCents) ||
      byDate.has(value.date)
    )
      return { ...result, reason: "invalid_values" };
    byDate.set(value.date, value);
  }
  const dailyFlows = new Map<string, { inflow: number; outflow: number }>();
  for (const flow of flows.filter(
    (f) => f.date > openingDate && f.date <= closingDate,
  )) {
    if (
      !validDate(flow.date) ||
      ![flow.inflowCents, flow.outflowCents].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      )
    )
      return { ...result, reason: "invalid_values" };
    const previous = dailyFlows.get(flow.date) ?? { inflow: 0, outflow: 0 };
    dailyFlows.set(flow.date, {
      inflow: sumCents([previous.inflow, flow.inflowCents]),
      outflow: sumCents([previous.outflow, flow.outflowCents]),
    });
  }
  let previous = byDate.get(openingDate),
    logGrowth = 0,
    investedDays = 0;
  if (!previous) return result;
  result.usesReconstructedValues = !!previous.reconstructed;
  for (
    let timestamp = Date.parse(openingDate) + 86_400_000;
    timestamp <= Date.parse(closingDate);
    timestamp += 86_400_000
  ) {
    const date = new Date(timestamp).toISOString().slice(0, 10),
      current = byDate.get(date);
    if (!current) return result;
    result.days++;
    result.usesReconstructedValues ||= !!current.reconstructed;
    const { inflow, outflow } = dailyFlows.get(date) ?? {
      inflow: 0,
      outflow: 0,
    };
    if (previous.valueCents < 0 || current.valueCents < 0)
      return { ...result, reason: "non_positive_capital" };
    // Idle zero-capital days do not create a return, or stop initial funding.
    if (
      previous.valueCents === 0 &&
      current.valueCents === 0 &&
      inflow === 0 &&
      outflow === 0
    ) {
      previous = current;
      continue;
    }
    const denominator = BigInt(previous.valueCents) + BigInt(inflow),
      numerator = BigInt(current.valueCents) + BigInt(outflow);
    if (denominator <= 0n) return { ...result, reason: "non_positive_capital" };
    const difference = numerator - denominator;
    // Exact cent differences avoid cancellation when capital is large.
    const small =
      (difference < 0n ? -difference : difference) * 2n < denominator;
    logGrowth +=
      numerator === 0n
        ? -Infinity
        : small
          ? Math.log1p(Number(difference) / Number(denominator))
          : Math.log(Number(numerator) / Number(denominator));
    investedDays++;
    previous = current;
  }
  if (!investedDays) return { ...result, reason: "no_invested_capital" };
  const rate = Math.expm1(logGrowth);
  if (!Number.isFinite(rate)) return { ...result, reason: "numeric_range" };
  // More than one calendar year of actual covered history, including leap years.
  const anniversary = new Date(openingDate + "T00:00:00Z");
  const openingMonth = anniversary.getUTCMonth();
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  if (anniversary.getUTCMonth() !== openingMonth) anniversary.setUTCDate(0);
  const annualizedRate =
    Date.parse(closingDate) > anniversary.getTime()
      ? Math.expm1((logGrowth * 365) / result.days)
      : null;
  return { ...result, status: "estimated", reason: null, rate, annualizedRate };
}
