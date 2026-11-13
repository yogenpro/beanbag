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
    cashSpending = total("spending"),
    stockSpending = total("stock_spending"),
    spending = sumCents([cashSpending, stockSpending]);
  const transfers = new Map<string, number>();
  for (const event of records.filter(
    (e) => e.kind === "internal_transfer" && e.status === "confirmed",
  )) {
    const group = event.transferGroup ?? event.id;
    transfers.set(
      group,
      Math.max(transfers.get(group) ?? 0, event.amountCents ?? 0),
    );
  }
  const unresolved = records.filter((e) => e.status === "needs_review");
  const months = [...new Set(records.map((e) => e.date.slice(0, 7)))].sort();
  return {
    period,
    totals: {
      cashIncome,
      stockIncome,
      totalIncome: sumCents([cashIncome, stockIncome]),
      spending,
      cashSpending,
      stockSpending,
      netCashFlow: sumCents([cashIncome, -cashSpending]),
      netRecordedFlow: sumCents([cashIncome, stockIncome, -spending]),
      internalTransfers: sumCents([...transfers.values()]),
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
      spending: sumCents([
        sumForMonth("spending", month),
        sumForMonth("stock_spending", month),
      ]),
    })),
    breakdown: [
      "cash_income",
      "stock_income",
      "spending",
      "stock_spending",
    ].flatMap((kind) => {
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
