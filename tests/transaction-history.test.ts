import { describe, expect, it, vi } from "vitest";
import { transferMatches } from "../src/accounting/classify";
import { checkingAssetTransactions } from "../src/providers/plaid/history";
import { transactionCoverage } from "../src/accounting/coverage";
import { defaultCoverage } from "../src/data/repository";
import { accounts } from "./fixtures";
import { MemoryLedger } from "../src/data/memory";
import { createApp } from "../src/api/app";
import { SyncService } from "../src/providers/plaid/sync";
import type { Dashboard } from "../src/ui/api";
import type { BankSource, Source } from "../src/accounting/types";

const at = "2026-11-13T20:00:00Z";
const history = {
  start: "2024-11-13",
  end: "2026-11-13",
  retrievedAt: at,
  source: "Invented provider history",
};
const coverage = (["checking", "investments"] as const).map((product) => ({
  ...defaultCoverage(product),
  history,
}));
const row = {
  account_id: accounts[0].id,
  transaction_id: "invented-asset-transaction",
  date: "2025-02-03",
  amount: "-123.45",
  iso_currency_code: "USD",
  original_description: "Invented external receipt",
  pending: false,
};
describe("historical transaction import", () => {
  it("preserves provider IDs, exact amounts, dates and original-description evidence", async () => {
    const [write] = await checkingAssetTransactions(
      { accountId: accounts[0].id, generatedAt: at, transactions: [row] },
      accounts[0].id,
    );
    expect(write.record).toMatchObject({
      id: row.transaction_id,
      accountId: accounts[0].id,
      date: row.date,
      amountCents: 12345,
      description: row.original_description,
    });
    expect(JSON.parse(write.raw)).toEqual({
      product: "assets",
      retrievedFromReport: at,
      transaction: row,
    });
  });
  it("rejects mixed account boundaries, duplicate IDs, unsettled and invalid transaction evidence", async () => {
    for (const bad of [
      { account_id: "outside" },
      { pending: true },
      { date: "2025-02-30" },
      { iso_currency_code: "CAD" },
      { transaction_id: undefined },
    ])
      await expect(
        checkingAssetTransactions(
          {
            accountId: accounts[0].id,
            transactions: [row, { ...row, transaction_id: "other", ...bad }],
          },
          accounts[0].id,
        ),
      ).rejects.toThrow();
    await expect(
      checkingAssetTransactions(
        { accountId: accounts[0].id, transactions: [row, row] },
        accounts[0].id,
      ),
    ).rejects.toThrow();
  });
  it("preserves a historical start and extends only overlapping investment collection windows", async () => {
    const repo = new MemoryLedger(accounts);
    repo.health = coverage.map((value) => ({
      ...value,
      startDate: history.start,
    }));
    const service = new SyncService(
      {
        post: async () => ({
          investment_transactions: [],
          securities: [],
          total_investment_transactions: 0,
        }),
      } as any,
      repo,
      "invented",
      () => new Date(at),
    );
    await service.investments("2026-08-15", "2026-11-13");
    expect(
      (await repo.coverage()).find((value) => value.product === "investments"),
    ).toMatchObject({
      startDate: history.start,
      history,
      completeThrough: null,
    });
    await service.investments("2027-06-01", "2027-08-01");
    expect(
      (await repo.coverage()).find((value) => value.product === "investments")
        ?.history,
    ).toEqual(history);
  });
});

describe("loaded transaction coverage", () => {
  it("matches larger histories while parsing transfer dates only once per record", () => {
    const sources: Source[] = [];
    for (let i = 0; i < 240; i++) {
      const common = {
        date: "2026-08-20",
        revision: "invented",
        currency: "USD",
        description: "Invented account transfer",
      };
      sources.push({
        ...common,
        kind: "bank",
        id: `checking-${i}`,
        accountId: accounts[0].id,
        amountCents: -10000 - i,
        pending: false,
      });
      sources.push({
        ...common,
        kind: "investment",
        id: `brokerage-${i}`,
        accountId: accounts[1].id,
        activity: "transfer",
        cashAmountCents: 10000 + i,
        direction: "unknown",
        origin: "unknown",
      });
    }
    const parsing = vi.spyOn(Date, "parse");
    try {
      expect(transferMatches(sources, accounts).size).toBe(sources.length);
      expect(parsing.mock.calls.length).toBeLessThanOrEqual(sources.length * 2);
    } finally {
      parsing.mockRestore();
    }
  });
  it("distinguishes available, partial, unavailable and unknown ranges without claiming completeness", () => {
    expect(
      transactionCoverage(coverage, { start: "2025-01-01", end: "2025-12-31" })
        .status,
    ).toBe("available");
    expect(
      transactionCoverage(coverage, { start: "2024-01-01", end: "2024-12-31" })
        .status,
    ).toBe("partial");
    expect(
      transactionCoverage(coverage, { start: "2023-01-01", end: "2023-12-31" })
        .status,
    ).toBe("unavailable");
    expect(
      transactionCoverage([defaultCoverage("checking"), coverage[1]], {
        start: "2025-01-01",
        end: "2025-12-31",
      }).status,
    ).toBe("unknown");
    expect(coverage.every((value) => value.completeThrough === null)).toBe(
      true,
    );
  });
  it("uses the shared window for full-period totals while retaining partial-account records", () => {
    const partial = [
      { ...coverage[0], history: { ...history, start: "2026-08-14" } },
      coverage[1],
    ];
    expect(
      transactionCoverage(partial, { start: "2025-01-01", end: "2025-12-31" }),
    ).toEqual({ status: "partial", start: "2026-08-14", end: history.end });
  });
  it("recomputes six different ranges from real stored event history through the report API", async () => {
    const cash: BankSource[] = [];
    for (const [index, [date, cents]] of (
      [
        ["2026-10-15", 10000],
        ["2026-08-14", 20000],
        ["2026-05-15", 25000],
        ["2026-02-15", 30000],
        ["2025-06-15", 40000],
        ["2024-11-20", 50000],
      ] as [string, number][]
    ).entries()) {
      cash.push({
        kind: "bank",
        id: `income-${index}`,
        accountId: accounts[0].id,
        date,
        description: "Invented external receipt",
        currency: "USD",
        revision: "invented",
        amountCents: cents,
        pending: false,
      });
      cash.push({
        ...cash.at(-1)!,
        id: `expense-${index}`,
        description: "Invented external payment",
        amountCents: -cents / 2,
      });
    }
    const repo = new MemoryLedger(accounts, cash);
    repo.health = coverage;
    const app = createApp({ demo: repo }),
      env = {
        LOCAL_DEMO: "true",
        ASSETS: {
          fetch: async () => new Response("invented"),
        } as unknown as Fetcher,
      };
    for (const [start, end, income] of [
      ["2026-10-12", "2026-11-12", 10000],
      ["2026-08-12", "2026-11-12", 30000],
      ["2026-05-12", "2026-11-12", 55000],
      ["2026-01-01", "2026-11-12", 85000],
      ["2025-01-01", "2025-12-31", 40000],
      [history.start, history.end, 175000],
    ] as [string, string, number][]) {
      const result = (await (
        await app.request(
          `http://localhost/api/report?start=${start}&end=${end}`,
          {},
          env,
        )
      ).json()) as Dashboard;
      expect(result.totals.cashIncome).toBe(income);
      expect(result.totals.spending).toBe(income / 2);
      expect(
        result.months.reduce((sum, month) => sum + month.cashIncome, 0),
      ).toBe(income);
      expect(
        result.records.every(
          (record) => record.date >= start && record.date <= end,
        ),
      ).toBe(true);
    }
  });
});
