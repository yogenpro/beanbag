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

/** Older invented observations deliberately sit beyond the five-year window. */
export function longProjectionFixture(): Dashboard {
  const fixture = projectionFixture();
  const older = projectionFixture();
  const earlierDate = (date: string) =>
    `${Number(date.slice(0, 4)) - 5}${date.slice(4)}`;
  fixture.records.push(
    ...older.records
      .filter((record) => record.date < "2026-05-01")
      .map((record) => ({
        ...record,
        id: `older-${record.id}`,
        sourceId: `older-${record.sourceId}`,
        date: earlierDate(record.date),
      })),
  );
  fixture.balances.history.unshift(
    ...older.balances.history
      .filter((point) => point.date < "2026-05-01")
      .map((point) => ({
        ...point,
        date: earlierDate(point.date),
        asOfDate: earlierDate(point.date),
        capturedAt: earlierDate(point.capturedAt),
      })),
  );
  fixture.availablePeriod.start = "2020-12-31";
  fixture.coverage.forEach((coverage) => {
    coverage.history!.start = "2021-01-01";
  });
  return fixture;
}

/** Four complete years, with cash + stock income growing 10%, 20%, then 10%. */
export function annualProjectionFixture(): Dashboard {
  const base = projectionFixture();
  const records: FinancialEvent[] = [],
    snapshots: BalanceSnapshot[] = [];
  const anchor = "2026-05-15";
  const factors = [1, 1.1, 1.32, 1.452];
  let net = 10_000_000;
  for (
    let time = Date.parse("2022-04-30");
    time <= Date.parse(anchor);
    time += 86_400_000
  ) {
    const date = new Date(time).toISOString().slice(0, 10);
    const index =
      (Number(date.slice(0, 4)) - 2022) * 12 + Number(date.slice(5, 7)) - 5;
    const year = Math.min(3, Math.max(0, Math.floor(index / 12)));
    let incoming = 0,
      outgoing = 0;
    if (date.endsWith("-10"))
      for (const [kind, amount] of [
        ["cash_income", 100_000 * factors[year]],
        ["stock_income", 50_000 * factors[year]],
        ["spending", 40_000 * 1.1 ** year],
        ["stock_spending", 10_000 * 1.1 ** year],
      ] as const) {
        const cents = Math.round(amount);
        if (kind === "cash_income" || kind === "stock_income")
          incoming += cents;
        else outgoing += cents;
        records.push({
          ...base.records[0],
          id: `${date}-${kind}`,
          sourceId: `${date}-${kind}`,
          date,
          kind,
          amountCents: cents,
        });
      }
    if (date !== "2022-04-30")
      net = Math.round((net + incoming) * 1.0001) - outgoing;
    snapshots.push({
      capturedAt: date + "T20:00:00Z",
      asOfDate: date,
      provider: "Invented annual-growth history",
      accounts: accounts.map((account, i) => ({
        accountId: account.id,
        currentCents: i ? net - 100_000 : 100_000,
        marginLoanCents: 0,
        currency: "USD",
        institutionUpdatedAt: null,
      })),
    });
  }
  const period = { start: "2022-04-30", end: anchor };
  const coverage = base.coverage.map((value) => ({
    ...value,
    history: { ...value.history!, start: "2022-05-01", end: anchor },
  }));
  const summary = report(records, period);
  return {
    ...base,
    ...summary,
    availablePeriod: period,
    trend: summary.months,
    coverage,
    balances: balanceReport(
      snapshots,
      accounts,
      emptyBalanceHealth(),
      period,
      new Date(anchor + "T21:00:00Z"),
      [],
      { events: records, coverage },
    ),
  };
}
