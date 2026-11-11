import { assertPeriod, type Period } from "./dates";
import { sumCents } from "./money";
import type { EventKind, FinancialEvent } from "./types";

export function report(events: FinancialEvent[], period: Period) {
  assertPeriod(period);
  const records = events.filter(
    (e) =>
      e.date >= period.start && e.date <= period.end && e.status !== "removed",
  );
  const total = (kind: EventKind) =>
    sumCents(
      records
        .filter((e) => e.kind === kind && e.status === "confirmed")
        .map((e) => e.amountCents ?? 0),
    );
  const cashIncome = total("cash_income"),
    stockIncome = total("stock_income"),
    spending = total("spending");
  const unresolved = records.filter((e) => e.status === "needs_review");
  const months = [...new Set(records.map((e) => e.date.slice(0, 7)))].sort();
  return {
    period,
    totals: {
      cashIncome,
      stockIncome,
      totalIncome: sumCents([cashIncome, stockIncome]),
      spending,
      netCashFlow: sumCents([cashIncome, -spending]),
      netRecordedFlow: sumCents([cashIncome, stockIncome, -spending]),
      internalTransfers: total("internal_transfer"),
    },
    review: {
      count: unresolved.length,
      knownCents: sumCents(unresolved.map((e) => e.amountCents ?? 0)),
      unvalued: unresolved.filter((e) => e.amountCents === null).length,
      dates: [...new Set(unresolved.map((e) => e.date))],
    },
    months: months.map((month) => ({
      month,
      cashIncome: sumForMonth("cash_income", month),
      stockIncome: sumForMonth("stock_income", month),
      spending: sumForMonth("spending", month),
    })),
    breakdown: ["cash_income", "stock_income", "spending"].flatMap((kind) => {
      const filtered = records.filter(
        (e) => e.kind === kind && e.status === "confirmed",
      );
      return [...new Set(filtered.map((e) => e.category))].map((category) => ({
        kind,
        category,
        amountCents: sumCents(
          filtered
            .filter((e) => e.category === category)
            .map((e) => e.amountCents ?? 0),
        ),
      }));
    }),
    records,
  };
  function sumForMonth(kind: EventKind, month: string) {
    return sumCents(
      records
        .filter(
          (e) =>
            e.date.startsWith(month) &&
            e.kind === kind &&
            e.status === "confirmed",
        )
        .map((e) => e.amountCents ?? 0),
    );
  }
}
export type Report = ReturnType<typeof report>;
