import { describe, expect, it, vi } from "vitest";
import { parse } from "lossless-json";
import {
  balanceReport,
  emptyBalanceHealth,
  type BalanceSnapshot,
} from "../src/accounting/balances";
import { report } from "../src/accounting/report";
import { MemoryLedger } from "../src/data/memory";
import { D1Ledger } from "../src/data/d1";
import { collectBalances } from "../src/providers/plaid/balances";
import { ProviderError, type PlaidApi } from "../src/providers/plaid/client";
import { accounts, investment, valuation } from "./fixtures";
import { sqliteD1 } from "./sqlite-d1";
import { createApp } from "../src/api/app";

const period = { start: "2026-08-01", end: "2026-08-31" };
const now = () => new Date("2026-08-15T18:00:00Z");
const snapshot = (at = now().toISOString()): BalanceSnapshot => ({
  capturedAt: at,
  provider: "Invented test balances",
  accounts: [
    {
      accountId: accounts[0].id,
      currentCents: 150000,
      marginLoanCents: 0,
      currency: "USD",
      institutionUpdatedAt: null,
    },
    {
      accountId: accounts[1].id,
      currentCents: 3800000,
      marginLoanCents: 200000,
      currency: "USD",
      institutionUpdatedAt: null,
    },
  ],
});
const rawChecking = () => ({
  accounts: [
    {
      account_id: accounts[0].id,
      type: "depository",
      subtype: "checking",
      balances: {
        current: "1500.005",
        available: "9000",
        iso_currency_code: "USD",
      },
    },
  ],
});
const rawBrokerage = () => ({
  accounts: [
    {
      account_id: accounts[1].id,
      type: "investment",
      balances: {
        current: "38000",
        available: "1000",
        margin_loan_amount: "2000",
        iso_currency_code: "USD",
      },
    },
  ],
  holdings: [{ institution_value: "9999999" }],
});
function apiFor(
  cash: unknown = rawChecking(),
  brokerage: unknown = rawBrokerage(),
) {
  const post = vi.fn().mockResolvedValueOnce(cash);
  if (brokerage instanceof Error) post.mockRejectedValueOnce(brokerage);
  else post.mockResolvedValueOnce(brokerage);
  return { api: { post } as PlaidApi, post };
}

describe("account balance observations", () => {
  it.each([0, 200000, 5000000])(
    "calculates net worth automatically with %i cents of borrowing, including negative equity",
    async (borrowing) => {
      const raw = rawBrokerage();
      raw.accounts[0].balances.margin_loan_amount = String(borrowing / 100);
      const repo = new MemoryLedger(accounts);
      await collectBalances(
        apiFor(rawChecking(), raw).api,
        repo,
        "synthetic",
        now,
      );
      const saved = await repo.balanceSnapshots();
      const point = balanceReport(
        saved,
        accounts,
        await repo.balanceHealth(),
        period,
        now(),
      ).latest;
      expect(point).toMatchObject({
        assetsCents: 3950001,
        marginLoanCents: borrowing,
        netWorthCents: 3950001 - borrowing,
      });
      expect(saved[0].borrowingConfirmation).toBeUndefined();
    },
  );
  it.each([null, 200000])(
    "preserves legacy confirmations without letting them replace reported borrowing %s",
    (borrowing) => {
      const legacy = snapshot();
      legacy.accounts[1].marginLoanCents = borrowing;
      legacy.borrowingConfirmation = {
        accountId: accounts[1].id,
        confirmedAt: now().toISOString(),
        actor: "test-owner",
        amountCents: 0,
      };
      const original = structuredClone(legacy);
      const point = balanceReport(
        [legacy],
        accounts,
        emptyBalanceHealth(),
        period,
        now(),
      ).latest;
      expect(point?.marginLoanCents).toBe(borrowing);
      expect(point?.netWorthCents).toBe(
        borrowing === null ? null : 3950000 - borrowing,
      );
      expect(legacy).toEqual(original);
    },
  );
  it("records borrowing and repayment in history without changing the account boundary or requiring confirmations", async () => {
    const repo = new MemoryLedger(accounts);
    for (const [day, borrowing] of [
      [15, "0"],
      [16, "2000"],
      [17, "0"],
    ] as const) {
      const raw = rawBrokerage();
      raw.accounts[0].balances.margin_loan_amount = borrowing;
      await collectBalances(
        apiFor(rawChecking(), raw).api,
        repo,
        "synthetic",
        () => new Date(`2026-08-${day}T18:00:00Z`),
      );
    }
    const points = balanceReport(
      await repo.balanceSnapshots(),
      accounts,
      await repo.balanceHealth(),
      period,
      now(),
    );
    expect(points.history.map((p) => p.netWorthCents)).toEqual([
      3950001, 3750001, 3950001,
    ]);
    expect(points.latest?.marginLoanCents).toBe(0);
    expect(await repo.events()).toEqual([]);
  });
  it("uses exact current balances, subtracts borrowing once, ignores available cash and extra holdings", async () => {
    const cash = rawChecking();
    cash.accounts.push({
      account_id: "unselected",
      type: "depository",
      subtype: "savings",
      balances: {
        current: "9999999",
        available: "9999999",
        iso_currency_code: "USD",
      },
    });
    const { api, post } = apiFor(cash);
    const repo = new MemoryLedger(accounts);
    await collectBalances(api, repo, "synthetic-token", now);
    const result = balanceReport(
      await repo.balanceSnapshots(),
      accounts,
      await repo.balanceHealth(),
      period,
      now(),
    );
    expect(result.latest).toMatchObject({
      assetsCents: 3950001,
      marginLoanCents: 200000,
      netWorthCents: 3750001,
    });
    expect(result.latest?.accounts).toHaveLength(2);
    expect(
      post.mock.calls.map(([path, body]) => [path, body.options.account_ids]),
    ).toEqual([
      ["/accounts/get", [accounts[0].id]],
      ["/investments/holdings/get", [accounts[1].id]],
    ]);
    expect(await repo.events()).toEqual([]);
    expect((await repo.balanceHealth()).error).toBeNull();
  });
  it("preserves lossless cents and negative checking balances", async () => {
    const cash = parse(
      JSON.stringify(rawChecking()).replace('"1500.005"', "-123.455"),
    );
    const repo = new MemoryLedger(accounts);
    await collectBalances(apiFor(cash).api, repo, "synthetic", now);
    expect((await repo.balanceSnapshots())[0].accounts[0].currentCents).toBe(
      -12346,
    );
  });
  it.each(["missing balance", "foreign currency", "missing borrowing"])(
    "does not turn %s into zero",
    async (condition) => {
      const raw = rawBrokerage() as any;
      if (condition === "missing balance")
        raw.accounts[0].balances.current = null;
      if (condition === "foreign currency")
        raw.accounts[0].balances.iso_currency_code = "CAD";
      if (condition === "missing borrowing")
        raw.accounts[0].balances.margin_loan_amount = null;
      const repo = new MemoryLedger(accounts);
      await collectBalances(
        apiFor(rawChecking(), raw).api,
        repo,
        "synthetic",
        now,
      );
      const result = balanceReport(
        await repo.balanceSnapshots(),
        accounts,
        await repo.balanceHealth(),
        period,
        now(),
      );
      expect(result.latest?.netWorthCents).toBeNull();
      if (condition !== "missing borrowing")
        expect(result.latest?.assetsCents).toBeNull();
      else expect(result.latest?.assetsCents).toBe(3950001);
    },
  );
  it.each([
    "provider failure",
    "missing selected account",
    "duplicate selected account",
    "changed account type",
    "invalid decimal",
    "negative borrowing",
  ])(
    "preserves prior history on %s and publishes no partial snapshot",
    async (condition) => {
      let raw: any = rawBrokerage();
      if (condition === "provider failure")
        raw = new ProviderError("ITEM_LOGIN_REQUIRED");
      if (condition === "missing selected account") raw.accounts = [];
      if (condition === "duplicate selected account")
        raw.accounts.push(raw.accounts[0]);
      if (condition === "changed account type") raw.accounts[0].type = "credit";
      if (condition === "invalid decimal")
        raw.accounts[0].balances.current = "Infinity";
      if (condition === "negative borrowing")
        raw.accounts[0].balances.margin_loan_amount = "-1";
      const repo = new MemoryLedger(accounts);
      await repo.saveBalanceSnapshot(snapshot("2026-08-14T18:00:00Z"));
      await expect(
        collectBalances(apiFor(rawChecking(), raw).api, repo, "synthetic", now),
      ).rejects.toThrow();
      expect(await repo.balanceSnapshots()).toHaveLength(1);
      expect(await repo.balanceHealth()).toMatchObject({
        lastSuccess: "2026-08-14T18:00:00Z",
        lastAttempt: now().toISOString(),
        error: expect.any(String),
      });
    },
  );
  it("does not change frozen receipt income when account market values change", async () => {
    const repo = new MemoryLedger(accounts, [
      investment({
        direction: "in",
        origin: "external",
        evidence: "Invented external receipt",
      }),
    ]);
    repo.prices["investment:stock-1"] = valuation();
    const before = report(await repo.events(), period);
    expect(before.totals.stockIncome).toBe(2000000);
    await collectBalances(apiFor().api, repo, "synthetic", now);
    expect(report(await repo.events(), period)).toEqual(before);
    expect(await repo.valuations()).toEqual({
      "investment:stock-1": valuation(),
    });
  });
});

describe("balance history and persistence", () => {
  it("keeps the latest separate from period history, selects the last Pacific observation each day, and never invents points", () => {
    const points = [
      snapshot("2026-08-14T18:00:00Z"),
      snapshot("2026-08-15T01:00:00Z"),
      snapshot("2026-08-17T18:00:00Z"),
    ];
    const result = balanceReport(
      points,
      accounts,
      emptyBalanceHealth(),
      { start: "2026-08-14", end: "2026-08-16" },
      now(),
    );
    expect(result.history.map((p) => p.date)).toEqual(["2026-08-14"]);
    expect(result.history[0].capturedAt).toBe("2026-08-15T01:00:00Z");
    expect(result.latest?.date).toBe("2026-08-17");
  });
  it("never splices histories after the selected account pair changes", () => {
    const changed = structuredClone(accounts);
    changed[1].id = "different-brokerage";
    const result = balanceReport(
      [snapshot()],
      changed,
      emptyBalanceHealth(),
      period,
      now(),
    );
    expect(result.latest).toBeNull();
    expect(result.history).toEqual([]);
  });
  it("flags old collections and old institution timestamps, without claiming unknown timestamps are fresh", () => {
    expect(
      balanceReport(
        [snapshot("2026-08-10T18:00:00Z")],
        accounts,
        emptyBalanceHealth(),
        period,
        now(),
      ).stale,
    ).toBe(true);
    const point = snapshot();
    point.accounts[1].institutionUpdatedAt = "2026-08-10T18:00:00Z";
    expect(
      balanceReport([point], accounts, emptyBalanceHealth(), period, now())
        .stale,
    ).toBe(true);
    point.accounts[1].institutionUpdatedAt = null;
    const result = balanceReport(
      [point],
      accounts,
      emptyBalanceHealth(),
      period,
      now(),
    );
    expect(result.stale).toBe(false);
    expect(result.latest?.accounts[1].institutionUpdatedAt).toBeNull();
  });
  it("persists immutable observations across repository reloads and retains health on out-of-order completions", async () => {
    const { db, sqlite } = sqliteD1();
    try {
      const repo = new D1Ledger(db);
      await repo.saveBalanceSnapshot(snapshot());
      const changed = snapshot();
      changed.accounts[0].currentCents = 1;
      await repo.saveBalanceSnapshot(changed);
      await repo.failBalanceRefresh(
        "2026-08-16T18:00:00Z",
        "ITEM_LOGIN_REQUIRED",
      );
      await repo.saveBalanceSnapshot(snapshot("2026-08-14T18:00:00Z"));
      const reload = new D1Ledger(db);
      expect(await reload.balanceSnapshots()).toHaveLength(2);
      expect((await reload.balanceSnapshots())[1]).toEqual(snapshot());
      expect(await reload.balanceHealth()).toEqual({
        lastSuccess: now().toISOString(),
        lastAttempt: "2026-08-16T18:00:00Z",
        error: "ITEM_LOGIN_REQUIRED",
      });
      await repo.saveBalanceSnapshot(snapshot("2026-08-17T18:00:00Z"));
      expect((await reload.balanceHealth()).error).toBeNull();
    } finally {
      sqlite.close();
    }
  });
  it("serves snapshots through the same private report route without changing income totals", async () => {
    const repo = new MemoryLedger(accounts);
    await repo.saveBalanceSnapshot(snapshot());
    const app = createApp({ demo: repo });
    const response = await app.request(
      "http://127.0.0.1/api/report?start=2026-07-01&end=2026-07-31",
      {},
      {
        LOCAL_DEMO: "true",
        ASSETS: { fetch: async () => new Response() },
      } as any,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.balances.latest.netWorthCents).toBe(3750000);
    expect(payload.balances.history).toEqual([]);
    expect(payload.totals.totalIncome).toBe(0);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
