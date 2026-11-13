import { describe, expect, it } from "vitest";
import { accountValueCsv } from "../src/accounting/history-csv";
import { checkingAssetValues } from "../src/providers/plaid/history";
import { accounts } from "./fixtures";
import { balanceReport, emptyBalanceHealth } from "../src/accounting/balances";
import {
  validateHistory,
  type HistoricalValue,
} from "../src/accounting/history";
import { D1Ledger } from "../src/data/d1";
import { sqliteD1 } from "./sqlite-d1";

describe("historical sources", () => {
  it("imports quoted brokerage net values, including debt, without subtracting borrowing twice", () => {
    const csv =
      'Daily account values for synthetic example\nDate,Total Account Value,Currency,Margin Debit\n08/12/2026,"$12,345.67",USD,$500.00\n08/11/2026,($42.50),USD,$500.00\n';
    expect(
      accountValueCsv(csv, accounts[1], "2026-08-13T00:00:00Z").map((v) => [
        v.netValueCents,
        v.borrowingCents,
      ]),
    ).toEqual([
      [-4250, null],
      [1234567, null],
    ]);
  });
  it.each([
    "Date,Market Value\n08/12/2026,100",
    "Date,Account Value\n02/30/2026,100",
    "Date,Account Value\n08/12/2026,100\n08/12/2026,100",
    "Date,Account Value,Currency\n08/12/2026,100,CAD",
  ])("rejects unsupported CSV data %s", (csv) =>
    expect(() =>
      accountValueCsv(csv, accounts[1], "2026-08-13T00:00:00Z"),
    ).toThrow(),
  );
  it("reads only the selected USD checking history from Assets", () => {
    const report = {
      items: [
        {
          accounts: [
            {
              account_id: "other",
              type: "depository",
              subtype: "checking",
              historical_balances: [
                {
                  date: "2026-08-12",
                  current: "999999",
                  iso_currency_code: "USD",
                },
              ],
            },
            {
              account_id: "checking",
              type: "depository",
              subtype: "checking",
              historical_balances: [
                {
                  date: "2026-08-12",
                  current: "-123.45",
                  iso_currency_code: "USD",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      checkingAssetValues(report, "checking", "2026-08-13T00:00:00Z"),
    ).toMatchObject([
      { accountId: "checking", netValueCents: -12345, method: "plaid_assets" },
    ]);
  });
});

const at = "2026-08-14T18:00:00Z";
const period = { start: "2026-08-01", end: "2026-08-31" };
const value = (
  accountId: string,
  date: string,
  netValueCents: number,
  method: HistoricalValue["method"] = "institution_export",
): HistoricalValue => ({
  accountId,
  date,
  calculatedAt: at,
  method,
  netValueCents,
  assetsCents: accountId === accounts[0].id ? netValueCents : null,
  borrowingCents: accountId === accounts[0].id ? 0 : null,
  source: "Invented institutional history",
});
describe("account-value history integration", () => {
  it("requires explicit mapping for ambiguous Amount exports and preserves account identity", () => {
    const csv = 'Date,Amount\n08/12/2026,"$1,234.56"\n';
    expect(() => accountValueCsv(csv, accounts[1], at)).toThrow(/column/);
    expect(
      accountValueCsv(
        "Date,Amount,Account Value\n08/12/2026,123.45,9999.99",
        accounts[1],
        at,
        "Amount",
      )[0].netValueCents,
    ).toBe(12345);
    expect(accountValueCsv(csv, accounts[0], at, "Amount")).toMatchObject([
      {
        accountId: accounts[0].id,
        assetsCents: 123456,
        borrowingCents: 0,
        method: "institution_export",
      },
    ]);
    expect(accountValueCsv(csv, accounts[1], at, "Amount")).toMatchObject([
      {
        accountId: accounts[1].id,
        assetsCents: null,
        borrowingCents: null,
        netValueCents: 123456,
      },
    ]);
  });
  it("combines only same-day account values and uses institutional exports before calculated Assets history", () => {
    const historical = [
      value(accounts[0].id, "2026-08-12", 10000, "plaid_assets"),
      value(accounts[0].id, "2026-08-12", 12000),
      value(accounts[1].id, "2026-08-12", 23000),
      value(accounts[1].id, "2026-08-13", 24000),
      value("other", "2026-08-14", 999999),
    ];
    const report = balanceReport(
      [],
      accounts,
      emptyBalanceHealth(),
      period,
      new Date(at),
      historical,
    );
    expect(report.history).toHaveLength(1);
    expect(report.latest).toMatchObject({
      date: "2026-08-12",
      netWorthCents: 35000,
      marginLoanCents: null,
      assetsCents: null,
    });
    expect(report.latest?.capturedAt).toBe(at);
  });
  it("uses the date reported by the institution without pretending it was collected then", () => {
    const imported = [
      value(accounts[0].id, "2026-08-13", 10000),
      value(accounts[1].id, "2026-08-13", 20000),
    ];
    const report = balanceReport(
      [],
      accounts,
      emptyBalanceHealth(),
      { start: "2026-07-01", end: "2026-07-31" },
      new Date(at),
      imported,
    );
    expect(report.latest?.date).toBe("2026-08-13");
    expect(report.history).toEqual([]);
    expect(report.latest?.capturedAt).toBe(at);
    expect(
      balanceReport(
        [],
        accounts,
        emptyBalanceHealth(),
        period,
        new Date("2026-09-01T18:00:00Z"),
        imported,
      ).stale,
    ).toBe(true);
  });
  it("never treats an empty account selection as a zero net worth", () => {
    expect(
      balanceReport([], [], emptyBalanceHealth(), period, new Date(at), [])
        .latest,
    ).toBeNull();
  });
  it("persists idempotently, rejects a mixed invalid batch atomically, and leaves original snapshots and events unchanged", async () => {
    const { db, sqlite } = sqliteD1();
    try {
      for (const a of accounts)
        sqlite
          .prepare("INSERT INTO accounts(id,role,label,mask) VALUES(?,?,?,?)")
          .run(a.id, a.role, a.label, a.mask);
      const repo = new D1Ledger(db),
        imported = [
          value(accounts[0].id, "2026-08-12", 10000),
          value(accounts[1].id, "2026-08-12", 20000),
        ];
      await repo.saveAccountValueHistory(imported);
      await repo.saveAccountValueHistory(imported);
      expect(await repo.accountValueHistory()).toHaveLength(2);
      await expect(
        repo.saveAccountValueHistory([
          value(accounts[0].id, "2026-08-13", 11000),
          value("outside", "2026-08-13", 99999),
        ]),
      ).rejects.toThrow();
      expect(await repo.accountValueHistory()).toHaveLength(2);
      expect(await repo.balanceSnapshots()).toEqual([]);
      expect(await repo.events()).toEqual([]);
      const older = {
        ...imported[0],
        calculatedAt: "2026-08-01T00:00:00Z",
        netValueCents: 1,
        assetsCents: 1,
      };
      await repo.saveAccountValueHistory([older]);
      expect(
        (await repo.accountValueHistory()).find(
          (v) => v.accountId === accounts[0].id,
        )?.netValueCents,
      ).toBe(10000);
    } finally {
      sqlite.close();
    }
  });
  it("rejects duplicate, inconsistent, unsafe or wrong-role history", () => {
    const good = value(accounts[0].id, "2026-08-12", 10000);
    expect(() => validateHistory([good, good], accounts)).toThrow(/Duplicate/);
    expect(() =>
      validateHistory([{ ...good, netValueCents: 20000 }], accounts),
    ).toThrow(/reconcile/);
    expect(() =>
      validateHistory(
        [{ ...good, netValueCents: Number.MAX_SAFE_INTEGER + 1 }],
        accounts,
      ),
    ).toThrow(/Invalid/);
    expect(() =>
      validateHistory(
        [value(accounts[1].id, "2026-08-12", 10000, "plaid_assets")],
        accounts,
      ),
    ).toThrow(/Invalid/);
  });
});
