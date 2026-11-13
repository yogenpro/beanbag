import type { BalancePoint } from "./balances";
import { transactionCoverage } from "./coverage";
import { assertPeriod, type Period } from "./dates";
import { sumCents } from "./money";
import { report } from "./report";
import type { Account, Coverage, FinancialEvent } from "./types";

export type ValueChange = {
  status: "estimated" | "unavailable";
  reason: "missing_balances" | "missing_history" | "unresolved_flows" | null;
  opening: { date: string; valueCents: number } | null;
  closing: { date: string; valueCents: number } | null;
  flowPeriod: Period | null;
  partialPeriod: boolean;
  estimatedBalances: boolean;
  changeCents: number | null;
  incomeCents: number | null;
  expensesCents: number | null;
  netFlowCents: number | null;
  investmentCents: number | null;
};
const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** Dollar attribution, not a rate of return or tax/cost-basis gain.
 * The residual includes investment income, costs and valuation/timing differences.
 */
export function accountValueChange(
  points: BalancePoint[],
  events: FinancialEvent[],
  accounts: Account[],
  coverage: Coverage[],
  period: Period,
): ValueChange {
  assertPeriod(period);
  const result: ValueChange = {
    status: "unavailable",
    reason: "missing_balances",
    opening: null,
    closing: null,
    flowPeriod: null,
    partialPeriod: false,
    estimatedBalances: false,
    changeCents: null,
    incomeCents: null,
    expensesCents: null,
    netFlowCents: null,
    investmentCents: null,
  };
  const ids = accounts
    .map((a) => a.id)
    .sort()
    .join("\n");
  if (accounts.length !== 2 || new Set(accounts.map((a) => a.role)).size !== 2)
    return result;
  const usable = points
    .filter(
      (p) =>
        p.netWorthCents !== null &&
        p.accounts
          .map((a) => a.accountId)
          .sort()
          .join("\n") === ids,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const selected = usable.filter(
    (p) => p.date >= period.start && p.date <= period.end,
  );
  const opening =
    usable.find((p) => p.date === shiftDay(period.start, -1)) ?? selected[0];
  const closing = selected.at(-1);
  if (!opening || !closing || opening.date >= closing.date) return result;
  const flowPeriod = { start: shiftDay(opening.date, 1), end: closing.date };
  Object.assign(result, {
    opening: { date: opening.date, valueCents: opening.netWorthCents! },
    closing: { date: closing.date, valueCents: closing.netWorthCents! },
    flowPeriod,
    changeCents: sumCents([closing.netWorthCents!, -opening.netWorthCents!]),
    partialPeriod:
      flowPeriod.start !== period.start || closing.date !== period.end,
    estimatedBalances: [opening, closing].some((p) =>
      p.historyMethods?.includes("reconstructed"),
    ),
  });
  // A balance curve alone cannot establish that an unexplained deposit was a gain.
  if (transactionCoverage(coverage, flowPeriod).status !== "available") {
    result.reason = "missing_history";
    return result;
  }
  const selectedIds = new Set(accounts.map((a) => a.id));
  const records = events.filter(
    (e) =>
      selectedIds.has(e.accountId) &&
      e.date >= flowPeriod.start &&
      e.date <= flowPeriod.end,
  );
  const flowKinds = new Set([
    "cash_income",
    "stock_income",
    "spending",
    "stock_spending",
  ]);
  if (
    records.some(
      (e) =>
        e.status === "needs_review" ||
        (e.status === "confirmed" &&
          (e.kind === "unknown" ||
            (flowKinds.has(e.kind) && e.amountCents === null))),
    )
  ) {
    result.reason = "unresolved_flows";
    return result;
  }
  const { totals } = report(records, flowPeriod);
  return {
    ...result,
    status: "estimated",
    reason: null,
    incomeCents: totals.totalIncome,
    expensesCents: totals.spending,
    netFlowCents: totals.netRecordedFlow,
    investmentCents: sumCents([result.changeCents!, -totals.netRecordedFlow]),
  };
}
