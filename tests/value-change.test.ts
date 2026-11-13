import { describe, expect, it } from "vitest";
import { accountValueChange } from "../src/accounting/value-change";
import {
  balancePoint,
  balanceReport,
  emptyBalanceHealth,
} from "../src/accounting/balances";
import type { FinancialEvent } from "../src/accounting/types";
import { defaultCoverage } from "../src/data/repository";
import { MemoryLedger } from "../src/data/memory";
import { createApp } from "../src/api/app";
import { accounts, bank } from "./fixtures";
import type { Dashboard } from "../src/ui/api";

const period = { start: "2026-08-01", end: "2026-08-31" };
const coverage = (["checking", "investments"] as const).map((product) => ({
  ...defaultCoverage(product),
  history: {
    start: "2026-01-01",
    end: "2026-09-30",
    source: "Invented activity",
    retrievedAt: "2026-10-01T00:00:00Z",
  },
}));
const point = (date: string, net: number) =>
  balancePoint(
    {
      capturedAt: date + "T20:00:00Z",
      asOfDate: date,
      provider: "Invented net values",
      historyMethods: ["institution_export"],
      accounts: accounts.map((a, i) => ({
        accountId: a.id,
        currentCents: null,
        marginLoanCents: null,
        currency: "USD",
        institutionUpdatedAt: null,
        netValueCents: i === 0 ? 10000 : net - 10000,
      })),
    },
    accounts,
  );
const flow = (
  id: string,
  kind: FinancialEvent["kind"],
  amountCents: number | null,
  date = "2026-08-10",
  status: FinancialEvent["status"] = "confirmed",
): FinancialEvent => ({
  id,
  sourceId: id,
  sourceType: "bank",
  accountId: accounts[0].id,
  date,
  description: "Invented activity",
  kind,
  status,
  amountCents,
  category: "Invented",
  reason: "Invented",
  ruleVersion: "boundary-2",
  revision: "v1",
});
const points = [
  point("2026-07-31", 100000),
  point("2026-08-01", 110000),
  point("2026-08-31", 140000),
  point("2026-09-01", 999999),
];

describe("account value change attribution", () => {
  it("uses daily cash and in-kind flows for TWR rather than dividing total gain by opening value", () => {
    const daily = [
      point("2026-07-31", 10000),
      point("2026-08-01", 22000),
      point("2026-08-02", 10900),
    ];
    const events = [
      flow("cash", "cash_income", 5000, "2026-08-01"),
      flow("stock", "stock_income", 5000, "2026-08-01"),
      flow("cash-out", "spending", 6000, "2026-08-02"),
      flow("stock-out", "stock_spending", 4000, "2026-08-02"),
      flow("trade", "ignored", 99999, "2026-08-01"),
      flow("pending", "cash_income", 99999, "2026-08-01", "pending"),
      {
        ...flow("outside", "cash_income", 99999, "2026-08-01"),
        accountId: "outside",
      },
    ];
    const result = accountValueChange(daily, events, accounts, coverage, {
      start: "2026-08-01",
      end: "2026-08-02",
    });
    expect(result).toMatchObject({
      investmentCents: 900,
      netFlowCents: 0,
      timeWeightedReturn: { status: "estimated", days: 2 },
    });
    expect(result.timeWeightedReturn.rate).toBeCloseTo(0.045, 12);
    expect(result.timeWeightedReturn.rate).not.toBe(900 / 10000);
  });
  it("reconciles cash and share income, all external expenses and a loss despite growing net value", () => {
    const events = [
      flow("cash", "cash_income", 100000),
      flow("shares", "stock_income", 20000),
      flow("card-payment", "spending", 30000),
      flow("share-withdrawal", "stock_spending", 10000),
      flow("trade", "ignored", 999999),
      flow("dividend", "ignored", 1200),
      flow("fee", "ignored", 500),
      flow("internal-out", "internal_transfer", 10000),
      flow("internal-in", "internal_transfer", 10000),
      flow("pending", "cash_income", 999999, period.end, "pending"),
      flow("removed", "spending", 999999, period.end, "removed"),
      { ...flow("other-account", "cash_income", 999999), accountId: "outside" },
    ];
    const original = structuredClone({ events, points });
    const result = accountValueChange(
      points,
      events,
      accounts,
      coverage,
      period,
    );
    expect(result).toMatchObject({
      status: "estimated",
      partialPeriod: false,
      opening: { date: "2026-07-31", valueCents: 100000 },
      closing: { date: period.end, valueCents: 140000 },
      flowPeriod: period,
      changeCents: 40000,
      incomeCents: 120000,
      expensesCents: 40000,
      netFlowCents: 80000,
      investmentCents: -40000,
      timeWeightedReturn: {
        status: "unavailable",
        reason: "missing_daily_values",
        rate: null,
      },
    });
    expect(result.netFlowCents! + result.investmentCents!).toBe(
      result.changeCents,
    );
    expect({ events, points }).toEqual(original);
  });
  it("counts the first selected day's flows using the prior day's value, including a one-day range", () => {
    const result = accountValueChange(
      points,
      [flow("first-day", "cash_income", 5000, period.start)],
      accounts,
      coverage,
      { start: period.start, end: period.start },
    );
    expect(result).toMatchObject({
      changeCents: 10000,
      incomeCents: 5000,
      investmentCents: 5000,
      partialPeriod: false,
    });
  });
  it("uses matching partial dates and excludes flows already contained in the first saved value", () => {
    const result = accountValueChange(
      points.slice(1, 3),
      [
        flow("already-in-opening", "cash_income", 99999, period.start),
        flow("new", "cash_income", 5000, "2026-08-02"),
        flow("after-close", "cash_income", 99999, "2026-09-01"),
      ],
      accounts,
      coverage,
      { start: "2026-07-01", end: "2026-09-30" },
    );
    expect(result).toMatchObject({
      flowPeriod: { start: "2026-08-02", end: "2026-08-31" },
      partialPeriod: true,
      changeCents: 30000,
      incomeCents: 5000,
      investmentCents: 25000,
    });
  });
  it.each(
    [
      [],
      [coverage[0]],
      [
        {
          ...coverage[0],
          history: { ...coverage[0].history!, start: "2026-08-02" },
        },
        coverage[1],
      ],
    ].map((history) => ({ history })),
  )("withholds residuals with missing transaction windows", ({ history }) => {
    expect(
      accountValueChange(points, [], accounts, history, period),
    ).toMatchObject({
      status: "unavailable",
      reason: "missing_history",
      changeCents: 40000,
      investmentCents: null,
      netFlowCents: null,
      timeWeightedReturn: {
        status: "unavailable",
        reason: "missing_history",
        rate: null,
      },
    });
  });
  it.each([
    flow("unvalued", "stock_income", null),
    flow("unclassified", "unknown", 100),
    flow("conflict", "cash_income", 100, period.start, "needs_review"),
  ])("withholds residuals when a flow is unresolved: $id", (event) => {
    expect(
      accountValueChange(points, [event], accounts, coverage, period),
    ).toMatchObject({
      reason: "unresolved_flows",
      investmentCents: null,
      timeWeightedReturn: { reason: "unresolved_flows", rate: null },
    });
  });
  it("distinguishes genuine zero flows, gains and negative account equity from missing data", () => {
    expect(
      accountValueChange(
        [point("2026-07-31", -5000), point("2026-08-31", -4000)],
        [],
        accounts,
        coverage,
        period,
      ),
    ).toMatchObject({
      status: "estimated",
      netFlowCents: 0,
      investmentCents: 1000,
    });
    expect(
      accountValueChange([points[1]], [], accounts, coverage, period),
    ).toMatchObject({ reason: "missing_balances", changeCents: null });
    expect(
      accountValueChange(points, [], [], coverage, period).investmentCents,
    ).toBeNull();
    expect(
      accountValueChange(
        points.map((p) => ({ ...p, netWorthCents: null })),
        [],
        accounts,
        coverage,
        period,
      ).investmentCents,
    ).toBeNull();
    const changed = structuredClone(accounts);
    changed[1].id = "different";
    expect(
      accountValueChange(points, [], changed, coverage, period).investmentCents,
    ).toBeNull();
  });
  it("deducts borrowing once and marks reconstructed endpoints", () => {
    const snapshots = [
      {
        capturedAt: "2026-07-31T20:00:00Z",
        provider: "Invented",
        accounts: accounts.map((a, i) => ({
          accountId: a.id,
          currentCents: i ? 50000 : 10000,
          marginLoanCents: i ? 30000 : 0,
          currency: "USD",
          institutionUpdatedAt: null,
        })),
      },
      {
        capturedAt: "2026-08-31T20:00:00Z",
        provider: "Invented",
        accounts: accounts.map((a, i) => ({
          accountId: a.id,
          currentCents: i ? 60000 : 10000,
          marginLoanCents: i ? 40000 : 0,
          currency: "USD",
          institutionUpdatedAt: null,
        })),
      },
    ];
    const result = balanceReport(
      snapshots,
      accounts,
      emptyBalanceHealth(),
      period,
      new Date("2026-08-31T21:00:00Z"),
      [],
      { events: [], coverage },
    );
    expect(result.change).toMatchObject({ changeCents: 0, investmentCents: 0 });
    const estimated = structuredClone(points);
    estimated[0].historyMethods = ["reconstructed"];
    expect(
      accountValueChange(estimated, [], accounts, coverage, period)
        .estimatedBalances,
    ).toBe(true);
  });
  it("serves aligned ranges from the read-only API while preserving the latest value and records", async () => {
    const repo = new MemoryLedger(accounts, [
      bank({ id: "start", date: period.start, amountCents: 5000 }),
      bank({ id: "end", date: period.end, amountCents: -2000 }),
    ]);
    repo.snapshots = points;
    repo.health = coverage;
    const events = await repo.events();
    const app = createApp({ demo: repo });
    const get = async (start: string, end: string) =>
      (await (
        await app.request(
          `http://127.0.0.1/api/report?start=${start}&end=${end}`,
          {},
          {
            LOCAL_DEMO: "true",
            ASSETS: { fetch: async () => new Response() },
          } as any,
        )
      ).json()) as Dashboard;
    const data = await get(period.start, period.end);
    expect(data.balances.change).toMatchObject({
      changeCents: 40000,
      incomeCents: 5000,
      expensesCents: 2000,
      investmentCents: 37000,
    });
    expect(data.balances.history.map((p) => p.date)).toEqual([
      period.start,
      period.end,
    ]);
    expect(data.balances.latest?.netWorthCents).toBe(999999);
    expect(
      (await get(period.start, period.start)).balances.change,
    ).toMatchObject({ incomeCents: 5000, investmentCents: 5000 });
    expect(
      (await get("2025-01-01", "2025-12-31")).balances.change?.reason,
    ).toBe("missing_balances");
    expect(await repo.events()).toEqual(events);
    expect(await repo.balanceSnapshots()).toEqual(points);
  });
});
