import { describe, expect, it } from "vitest";
import { classify, transferMatches } from "../src/accounting/classify";
import { cents, sumCents, valueShares } from "../src/accounting/money";
import { assertPeriod, pacificToday, periodFor } from "../src/accounting/dates";
import { report } from "../src/accounting/report";
import { reclassify } from "../src/data/repository";
import { ReviewedHistoricalPrices } from "../src/providers/prices/historical";
import { accounts, bank, investment, override, valuation } from "./fixtures";
import type { EventKind, Source } from "../src/accounting/types";

describe("two-account boundary", () => {
  const cases: [string, Source, EventKind, number][] = [
    ["payroll", bank(), "cash_income", 400000],
    [
      "one-sided checking to brokerage",
      bank({
        description: "Transfer to Brokerage -0002",
        amountCents: -1000000,
      }),
      "internal_transfer",
      1000000,
    ],
    [
      "one-sided overdraft funding",
      bank({
        description: "Overdraft Transfer from Brokerage -0002",
        amountCents: 350000,
      }),
      "internal_transfer",
      350000,
    ],
    [
      "card payment categorized transfers",
      bank({
        description: "Amex card payment",
        category: "transfers",
        amountCents: -350000,
      }),
      "spending",
      350000,
    ],
    [
      "outgoing Zelle",
      bank({
        description: "Zelle to recipient",
        category: "transfers",
        amountCents: -20000,
      }),
      "spending",
      20000,
    ],
    [
      "incoming Zelle",
      bank({ description: "Zelle received", amountCents: 5000 }),
      "cash_income",
      5000,
    ],
    [
      "external refund",
      bank({ description: "Store refund", amountCents: 7500 }),
      "cash_income",
      7500,
    ],
    [
      "other personal account",
      bank({
        description: "Transfer to personal savings",
        amountCents: -45000,
      }),
      "spending",
      45000,
    ],
    [
      "checking fee",
      bank({ description: "Service fee", amountCents: -1500 }),
      "spending",
      1500,
    ],
    [
      "explicit brokerage counterparty",
      bank({
        description: "Unstructured movement",
        counterpartAccountId: accounts[1].id,
      }),
      "internal_transfer",
      400000,
    ],
    ["outside account", bank({ accountId: "unselected" }), "ignored", 0],
    ["stock receipt", investment(), "stock_income", 2000000],
    ...[
      "buy",
      "sell",
      "dividend",
      "interest",
      "split",
      "reinvestment",
      "corporate_action",
    ].map(
      (activity) =>
        [activity, investment({ activity }), "ignored", 0] as [
          string,
          Source,
          EventKind,
          number,
        ],
    ),
    [
      "later brokerage proceeds",
      investment({ activity: "cash", cashAmountCents: 2200000 }),
      "ignored",
      0,
    ],
  ];
  it.each(cases)("%s", (_name, source, expectedKind, expectedCents) => {
    const event = classify(
      source as ReturnType<typeof bank> | ReturnType<typeof investment>,
      accounts,
      undefined,
      valuation(),
    );
    expect(event.kind).toBe(expectedKind);
    expect(event.amountCents).toBe(expectedCents);
    expect(event.status).toBe("confirmed");
  });
  it("treats unmatched cash movements and other brokerages as external flows", () => {
    expect(
      classify(bank({ description: "Brokerage cash movement" }), accounts)
        .status,
    ).toBe("confirmed");
    expect(
      classify(
        bank({ description: "Overdraft Transfer from Brokerage -9999" }),
        accounts,
      ).kind,
    ).toBe("cash_income");
  });
  it.each([
    { securityId: undefined },
    { quantity: undefined },
    { quantity: "0" },
  ] as const)(
    "keeps uncertain share receipt out of confirmed income: %o",
    (patch) => {
      expect(
        classify(investment(patch), accounts, undefined, valuation()).status,
      ).toBe("needs_review");
    },
  );
  it("does not infer receipts from unknown investment activity", () =>
    expect(
      classify(investment({ activity: "id_remapping" }), accounts).status,
    ).toBe("needs_review"));
  it("never substitutes a current quote for a missing historical quote", () =>
    expect(classify(investment(), accounts).status).toBe("needs_review"));
  it("freezes original receipt value through sale, appreciation and later cash transfer", () => {
    const events = [
      classify(investment(), accounts, undefined, valuation()),
      classify(
        investment({ id: "sale", activity: "sell", cashAmountCents: 2200000 }),
        accounts,
      ),
      classify(
        bank({
          id: "proceeds",
          description: "Transfer from Brokerage -0002",
          amountCents: 2200000,
        }),
        accounts,
      ),
    ];
    const r = report(events, { start: "2026-08-01", end: "2026-08-31" });
    expect(r.totals.stockIncome).toBe(2000000);
    expect(r.totals.cashIncome).toBe(0);
  });
  it("pending and removed source data cannot be promoted by an override", () => {
    expect(
      classify(
        bank({ pending: true }),
        accounts,
        override({ kind: "cash_income" }),
      ).status,
    ).toBe("pending");
    expect(
      classify(
        bank({ removed: true }),
        accounts,
        override({ kind: "cash_income" }),
      ).status,
    ).toBe("removed");
  });
  it("manual override wins, persists, and requires review when provider evidence changes", () => {
    const source = bank({
      description: "Transfer to Brokerage",
      amountCents: -100000,
    });
    expect(
      classify(source, accounts, override({ kind: "spending" })).kind,
    ).toBe("spending");
    const changed = classify(
      { ...source, revision: "v2" },
      accounts,
      override({ kind: "spending" }),
    );
    expect(changed.status).toBe("needs_review");
    expect(changed.overrideId).toBe("review-1");
  });
  it("supports posting-date correction without shifting institution dates through UTC", () => {
    expect(
      classify(
        bank(),
        accounts,
        override({ kind: "cash_income", date: "2026-09-01" }),
      ).date,
    ).toBe("2026-09-01");
  });
  it("never labels an investment purchase as stock receipt via a bad override", () => {
    expect(
      classify(
        investment({ activity: "buy" }),
        accounts,
        override({ kind: "stock_income", valuation: valuation() }),
      ).status,
    ).toBe("needs_review");
  });
  it("detects possible duplicate manual/provider receipts", () => {
    const first = investment({ id: "manual:receipt", manual: true }),
      second = investment({
        id: "provider-receipt",
        origin: "unknown",
        quantity: "100.000000",
      });
    const events = reclassify([first, second], accounts, [], {
      "investment:manual:receipt": valuation(),
    });
    expect(events[0].status).toBe("needs_review");
    expect(events[0].reason).toContain("duplicate");
  });
});
describe("verified transfer matching", () => {
  it("requires a unique opposite leg and shared stable evidence", () => {
    const checking = bank({
      amountCents: 10000,
      transferReference: "same-reference",
    });
    const brokerage = investment({
      activity: "cash",
      cashAmountCents: -10000,
      transferReference: "same-reference",
    });
    expect(
      transferMatches([checking, brokerage], accounts).has("bank:bank-1"),
    ).toBe(true);
    expect(
      transferMatches(
        [{ ...checking, transferReference: undefined }, brokerage],
        accounts,
      ).size,
    ).toBe(0);
    expect(
      transferMatches(
        [checking, brokerage, { ...brokerage, id: "ambiguous" }],
        accounts,
      ).size,
    ).toBe(0);
    expect(
      transferMatches(
        [checking, { ...checking, id: "second" }, brokerage],
        accounts,
      ).size,
    ).toBe(0);
    expect(
      transferMatches(
        [checking, { ...brokerage, date: "2026-09-10" }],
        accounts,
      ).size,
    ).toBe(0);
  });
});
describe("historical exact decimal valuation", () => {
  it.each([
    ["0.005", 1],
    ["-0.005", -1],
    ["1.255", 126],
    ["163.23", 16323],
  ])("rounds %s at the event boundary", (input, result) =>
    expect(cents(input)).toBe(result),
  );
  it("multiplies exact fractional shares and rounds only the final event", () => {
    expect(valueShares("0.1", "0.05")).toBe(1);
    // Independently checked with Python decimal ROUND_HALF_UP.
    expect(valueShares("123.123456789012345678", "201.12345678")).toBe(2476302);
    expect(() => valueShares("1e10", "10")).toThrow();
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
  it("accepts the latest prior session close and preserves its date and source", async () => {
    const receipt = investment({ date: "2026-08-09" });
    const quote = valuation({
      eventDate: receipt.date,
      priceDate: "2026-08-07",
    });
    const provider = new ReviewedHistoricalPrices([quote]);
    const e = classify(
      receipt,
      accounts,
      undefined,
      (await provider.arrivalClose(receipt))!,
    );
    expect(e.status).toBe("confirmed");
    expect(e.valuation?.priceDate).toBe("2026-08-07");
  });
  it.each([
    { priceDate: "2026-08-11" },
    { priceDate: "2026-07-01" },
    { securityId: "wrong" },
    { quantity: "99" },
    { eventDate: "2026-08-09" },
  ])("rejects mismatched or stale evidence %o", (patch) => {
    expect(
      classify(investment(), accounts, undefined, valuation(patch)).status,
    ).toBe("needs_review");
  });
});
describe("report reconciliation and Pacific dates", () => {
  it("reconciles both net measures with exact cents and separates unresolved/pending", () => {
    const events = [
      classify(bank(), accounts),
      classify(bank({ id: "payment", amountCents: -350000 }), accounts),
      classify(investment(), accounts, undefined, valuation()),
      classify(bank({ id: "pending", pending: true }), accounts),
      classify(investment({ id: "unvalued" }), accounts),
      classify(
        bank({
          id: "ambiguous",
          description: "Brokerage move",
          amountCents: -5000,
        }),
        accounts,
      ),
    ];
    const r = report(events, { start: "2026-08-01", end: "2026-08-31" });
    expect(r.totals).toMatchObject({
      cashIncome: 400000,
      stockIncome: 2000000,
      totalIncome: 2400000,
      spending: 355000,
      netCashFlow: 45000,
      netRecordedFlow: 2045000,
    });
    expect(r.review).toMatchObject({ count: 1, unvalued: 1, knownCents: 0 });
  });
  it("uses Pacific date through UTC midnight and daylight-saving boundaries", () => {
    expect(pacificToday(new Date("2026-09-01T01:00:00Z"))).toBe("2026-08-31");
    expect(periodFor("month", new Date("2026-09-01T01:00:00Z"))).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    expect(periodFor("previous", new Date("2026-01-15T12:00:00Z"))).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
    expect(periodFor("quarter", new Date("2026-11-02T05:00:00Z")).start).toBe(
      "2026-10-01",
    );
    expect(() =>
      assertPeriod({ start: "2026-02-30", end: "2026-03-01" }),
    ).toThrow();
    expect(() =>
      assertPeriod({ start: "2026-08-31", end: "2026-08-01" }),
    ).toThrow();
  });
});
