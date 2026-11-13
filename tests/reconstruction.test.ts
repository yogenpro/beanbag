import { describe, expect, it } from "vitest";
import {
  reconstructDailyValues,
  type BalanceActivity,
} from "../src/accounting/reconstruction";
const event = (
  id: string,
  date: string,
  cashChangeCents: number,
  quantityChange = "0",
  securityId: string | null = null,
): BalanceActivity => ({
  id,
  date,
  cashChangeCents,
  quantityChange,
  securityId,
});
const base = {
  start: "2026-01-02",
  end: "2026-01-05",
  settlement: "same_day" as const,
  openingCashCents: 0,
  openingPositions: [],
  activity: [
    event("deposit", "2026-01-02", 10000),
    event("buy", "2026-01-02", -20000, "2", "EXM"),
    event("dividend", "2026-01-05", 123),
    event("fee", "2026-01-05", -50),
    event("margin-interest", "2026-01-05", -25),
  ],
  closes: [
    {
      securityId: "EXM",
      date: "2026-01-02",
      close: "100",
      source: "Invented as-traded close",
    },
    {
      securityId: "EXM",
      date: "2026-01-05",
      close: "101.005",
      source: "Invented as-traded close",
    },
  ],
};
describe("daily balance reconstruction", () => {
  it("applies same-day cash and shares, all activity and borrowing exactly once", () => {
    const original = structuredClone(base);
    const result = reconstructDailyValues(base);
    expect(
      result.map((r) => [r.date, r.netCashCents, r.netValueCents]),
    ).toEqual([
      ["2026-01-02", -10000, 10000],
      ["2026-01-03", -10000, 10000],
      ["2026-01-04", -10000, 10000],
      ["2026-01-05", -9952, 10249],
    ]);
    expect(result[2].positions[0].priceDate).toBe("2026-01-02");
    expect(base).toEqual(original);
  });
  it("handles exact fractional shares, reinvestment and cancelling internal share journals", () => {
    const result = reconstructDailyValues({
      ...base,
      openingCashCents: 0,
      activity: [
        event("receipt", "2026-01-02", 0, "0.123456789012345678901234", "EXM"),
        event("journal-in", "2026-01-02", 0, "5", "EXM"),
        event("journal-out", "2026-01-02", 0, "-5", "EXM"),
        event("cash-dividend", "2026-01-05", 100),
        event("reinvest", "2026-01-05", -100, "0.01", "EXM"),
      ],
    });
    expect(result.at(-1)?.netCashCents).toBe(0);
    expect(result.at(-1)?.positions[0].quantity).toBe(
      "0.133456789012345678901234",
    );
  });
  it("applies splits before that day's activity using as-traded prices", () => {
    const result = reconstructDailyValues({
      ...base,
      activity: base.activity.slice(0, 2),
      splits: [
        { securityId: "EXM", date: "2026-01-05", numerator: 2, denominator: 1 },
      ],
      closes: [base.closes[0], { ...base.closes[1], close: "50.5025" }],
    });
    expect(result.at(-1)?.positions[0].quantity).toBe("4");
    expect(result.at(-1)?.netValueCents).toBe(10201);
  });
  it("never uses future quotes or carries an ordinary security through a long price gap", () => {
    expect(() =>
      reconstructDailyValues({ ...base, closes: [base.closes[1]] }),
    ).toThrow(/Missing historical/);
    expect(() =>
      reconstructDailyValues({ ...base, end: "2026-01-20" }),
    ).toThrow(/Missing historical/);
  });
  it("requires stable issuer NAV evidence and rejects a NAV that changed", () => {
    const fund = {
      ...base,
      end: "2026-01-20",
      activity: base.activity.slice(0, 2),
      closes: [{ ...base.closes[0], close: "1" }],
      stableNavs: [
        {
          securityId: "EXM",
          nav: "1",
          source: "Invented issuer transaction NAV basis",
          evidenceSha256: "a".repeat(64),
        },
      ],
    };
    const result = reconstructDailyValues(fund);
    expect(result.at(-1)?.positions[0]).toMatchObject({
      priceBasis: "stable_transaction_nav",
      priceDate: "2026-01-02",
      close: "1",
    });
    expect(() =>
      reconstructDailyValues({
        ...fund,
        closes: [
          ...fund.closes,
          { ...fund.closes[0], date: "2026-01-05", close: "0.99" },
        ],
      }),
    ).toThrow(/stable transaction NAV/);
    expect(() =>
      reconstructDailyValues({
        ...fund,
        stableNavs: [{ ...fund.stableNavs[0], evidenceSha256: "" }],
      }),
    ).toThrow();
  });
  it("rejects duplicate events, out-of-window activity, short positions and unsafe cash", () => {
    expect(() =>
      reconstructDailyValues({
        ...base,
        activity: [base.activity[0], base.activity[0]],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      reconstructDailyValues({ ...base, start: "2026-01-03" }),
    ).toThrow(/activity/);
    expect(() =>
      reconstructDailyValues({
        ...base,
        activity: [event("short", "2026-01-02", 10000, "-1", "EXM")],
      }),
    ).toThrow(/Short positions/);
    expect(() =>
      reconstructDailyValues({
        ...base,
        openingCashCents: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });
});
