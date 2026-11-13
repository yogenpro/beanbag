import {
  balanceReport,
  emptyBalanceHealth,
  type BalanceSnapshot,
} from "../src/accounting/balances";
import { report } from "../src/accounting/report";
import { defaultCoverage } from "../src/data/repository";
import type { FinancialEvent } from "../src/accounting/types";
import type { Dashboard } from "../src/ui/api";
import { accounts } from "./fixtures";

export function projectionFixture(): Dashboard {
  const coverage = (["checking", "investments"] as const).map((product) => ({
    ...defaultCoverage(product),
    history: {
      start: "2026-01-01",
      end: "2026-05-15",
      source: "Invented history",
      retrievedAt: "2026-05-15T20:00:00Z",
    },
  }));
  const records: FinancialEvent[] = [];
  const snapshots: BalanceSnapshot[] = [];
  let net = 10_000_000;
  for (
    let timestamp = Date.parse("2025-12-31");
    timestamp <= Date.parse("2026-05-15");
    timestamp += 86_400_000
  ) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const month = new Date(timestamp).getUTCMonth();
    const monthlyReturn = [0.01, -0.005, 0.02, 0.015, 0.01][month] ?? 0;
    const days = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
    const hasFlows = date.endsWith("-10");
    if (hasFlows) {
      for (const [kind, cents] of [
        ["cash_income", 100_000],
        ["spending", 40_000],
        ["stock_income", 50_000],
        ["stock_spending", 10_000],
      ] as const) {
        records.push({
          id: `${date}-${kind}`,
          sourceId: `${date}-${kind}`,
          sourceType: "bank",
          accountId: accounts[0].id,
          date,
          description: "Invented projection activity",
          kind,
          status: "confirmed",
          amountCents: cents,
          category: "Invented",
          reason: "Invented",
          ruleVersion: "boundary-2",
          revision: "v1",
        });
      }
    }
    if (date !== "2025-12-31")
      net =
        Math.round(
          (net + (hasFlows ? 150_000 : 0)) * (1 + monthlyReturn) ** (1 / days),
        ) - (hasFlows ? 50_000 : 0);
    snapshots.push({
      capturedAt: date + "T20:00:00Z",
      asOfDate: date,
      provider: "Invented balances",
      accounts: accounts.map((account, i) => ({
        accountId: account.id,
        currentCents: i ? net - 100_000 : 100_000,
        marginLoanCents: 0,
        currency: "USD",
        institutionUpdatedAt: null,
      })),
    });
  }
  const period = { start: "2025-12-31", end: "2026-05-15" };
  const summary = report(records, period);
  return {
    ...summary,
    availablePeriod: period,
    balances: balanceReport(
      snapshots,
      accounts,
      emptyBalanceHealth(),
      period,
      new Date("2026-05-15T21:00:00Z"),
      [],
      { events: records, coverage },
    ),
    accounts,
    coverage,
    illustrative: true,
    connectionStatus: "illustrative",
    trend: summary.months,
  };
}
