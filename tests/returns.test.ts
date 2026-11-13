import { describe, expect, it } from "vitest";
import { dailyTimeWeightedReturn } from "../src/accounting/returns";

const values = (...amounts: number[]) =>
  amounts.map((valueCents, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    valueCents,
  }));
const calculate = (
  amounts: number[],
  flows: { date: string; inflowCents: number; outflowCents: number }[] = [],
) =>
  dailyTimeWeightedReturn(
    values(...amounts),
    flows,
    "2026-01-01",
    `2026-01-${String(amounts.length).padStart(2, "0")}`,
  );
describe("daily time-weighted return", () => {
  it("geometrically links daily returns and never annualizes a short period", () => {
    expect(calculate([10000, 11000, 10450]).rate).toBeCloseTo(0.045, 12);
    expect(calculate([10000, 11000]).rate).toBeCloseTo(0.1, 12);
    expect(calculate([10000, 11000]).annualizedRate).toBeNull();
  });
  const longPeriod = (start: string, end: string, endingValue = 1210000) => {
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    return dailyTimeWeightedReturn(
      Array.from({ length: days + 1 }, (_, i) => ({
        date: new Date(Date.parse(start) + i * 86_400_000)
          .toISOString()
          .slice(0, 10),
        valueCents: Math.round(1000000 + ((endingValue - 1000000) * i) / days),
      })),
      [],
      start,
      end,
    );
  };
  it("retains cumulative TWR and compounds a multi-year annualized return", () => {
    const result = longPeriod("2024-12-31", "2026-12-31");
    expect(result.rate).toBeCloseTo(0.21, 12);
    expect(result.annualizedRate).toBeCloseTo(0.1, 12);
    expect(result.days).toBe(730);
  });
  it.each([
    ["2023-02-28", "2024-02-28", false],
    ["2023-03-01", "2024-03-01", false],
    ["2024-02-29", "2025-02-28", false],
    ["2024-02-29", "2025-03-01", true],
    ["2025-01-01", "2026-01-02", true],
  ])(
    "annualizes only beyond the calendar anniversary: %s to %s",
    (start, end, eligible) => {
      const result = longPeriod(start, end);
      if (eligible)
        expect(result.annualizedRate).toBeCloseTo(
          Math.pow(1.21, 365 / result.days) - 1,
          12,
        );
      else expect(result.annualizedRate).toBeNull();
    },
  );
  it.each([
    [1000000, 0],
    [810000, -0.1],
    [0, -1],
  ])(
    "supports flat, negative and complete-loss annualized performance (%s)",
    (end, expected) => {
      expect(
        longPeriod("2024-12-31", "2026-12-31", end).annualizedRate,
      ).toBeCloseTo(expected, 12);
    },
  );
  it("removes capital contributions and withdrawals from performance", () => {
    const result = calculate(
      [10000, 22000, 10900],
      [
        { date: "2026-01-02", inflowCents: 10000, outflowCents: 0 },
        { date: "2026-01-03", inflowCents: 0, outflowCents: 10000 },
      ],
    );
    expect(result).toMatchObject({
      status: "estimated",
      days: 2,
      method: "daily_start_inflows_end_outflows",
    });
    expect(result.rate).toBeCloseTo(0.045, 12);
  });
  it("keeps same-day gross inflows and outflows separate instead of netting them", () => {
    expect(
      calculate(
        [10000, 12500],
        [{ date: "2026-01-02", inflowCents: 5000, outflowCents: 4000 }],
      ).rate,
    ).toBeCloseTo(0.1, 12);
  });
  it("handles initial funding, empty days, complete withdrawals and later deposits", () => {
    const result = calculate(
      [0, 0, 11000, 0, 0, 20000],
      [
        { date: "2026-01-03", inflowCents: 10000, outflowCents: 0 },
        { date: "2026-01-04", inflowCents: 0, outflowCents: 11000 },
        { date: "2026-01-06", inflowCents: 20000, outflowCents: 0 },
      ],
    );
    expect(result.rate).toBeCloseTo(0.1, 12);
    expect(result.days).toBe(5);
    expect(calculate([0, 0, 0])).toMatchObject({
      rate: null,
      reason: "no_invested_capital",
    });
  });
  it("distinguishes zero performance and a complete loss from unavailable data", () => {
    expect(calculate([10000, 10000])).toMatchObject({
      status: "estimated",
      rate: 0,
    });
    expect(calculate([10000, 0, 0])).toMatchObject({
      status: "estimated",
      rate: -1,
    });
    expect(calculate([10000, 9000]).rate).toBeCloseTo(-0.1, 12);
  });
  it.each([
    [0, 10000],
    [-10000, 10000],
    [10000, -100],
  ])("withholds a percentage for nonpositive net capital: %j", (a, b) => {
    expect(calculate([a, b])).toMatchObject({
      rate: null,
      reason: "non_positive_capital",
    });
  });
  it("requires every daily value, including one on a no-flow day", () => {
    expect(
      dailyTimeWeightedReturn(
        [values(10000)[0], { date: "2026-01-03", valueCents: 11000 }],
        [],
        "2026-01-01",
        "2026-01-03",
      ),
    ).toMatchObject({ rate: null, reason: "missing_daily_values" });
  });
  it("marks reconstructed intermediate values and leaves source arrays untouched", () => {
    const source = values(10000, 11000, 10450).map((v, i) => ({
        ...v,
        reconstructed: i === 1,
      })),
      original = structuredClone(source);
    expect(
      dailyTimeWeightedReturn(source, [], "2026-01-01", "2026-01-03")
        .usesReconstructedValues,
    ).toBe(true);
    expect(source).toEqual(original);
  });
  it("excludes flows already in the opening value or after the end", () => {
    expect(
      calculate(
        [10000, 11000],
        [
          { date: "2026-01-01", inflowCents: 99999, outflowCents: 0 },
          { date: "2026-01-03", inflowCents: 0, outflowCents: 99999 },
        ],
      ).rate,
    ).toBeCloseTo(0.1, 12);
  });
  it("retains exact cent differences on large balances", () => {
    const result = calculate([100000000000000, 100000000000001]);
    expect(result.rate).toBeGreaterThan(0);
    expect(result.rate).toBeCloseTo(1e-14, 25);
  });
  it("rejects duplicate dates and invalid money", () => {
    expect(
      dailyTimeWeightedReturn(
        [...values(10000, 11000), values(10000)[0]],
        [],
        "2026-01-01",
        "2026-01-02",
      ).reason,
    ).toBe("invalid_values");
    expect(calculate([10000, 10000.5]).reason).toBe("invalid_values");
    expect(
      calculate(
        [10000, 11000],
        [{ date: "2026-01-02", inflowCents: -1, outflowCents: 0 }],
      ).reason,
    ).toBe("invalid_values");
  });
  it("never exposes an infinite compounded percentage", () => {
    const series = Array.from({ length: 22 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      valueCents: 1,
    }));
    const flows = series.slice(1).map((v) => ({
      date: v.date,
      inflowCents: 0,
      outflowCents: Number.MAX_SAFE_INTEGER - 1,
    }));
    expect(
      dailyTimeWeightedReturn(
        series,
        flows,
        series[0].date,
        series.at(-1)!.date,
      ),
    ).toMatchObject({ rate: null, reason: "numeric_range" });
  });
});
