import { describe, expect, it } from "vitest";
import {
  annualFlowTrends,
  calibrateProjection,
  monthBounds,
  projectAccountValue,
  projectIncome,
  projectedMonthlyFlows,
  type MonthlyFlows,
  type ProjectionAssumptions,
} from "../src/ui/projection-model";
import {
  annualProjectionFixture,
  longProjectionFixture,
  projectionFixture,
} from "./projection-fixtures";

const assumptions: ProjectionAssumptions = {
  cashIncome: 1000,
  stockIncome: 500,
  cashPayments: 400,
  stockPayments: 100,
  incomeGrowth: 0,
  paymentGrowth: 0,
  incomeVolatility: 0,
  paymentVolatility: 0,
  growth: 0,
  volatility: 0,
};
const monthly = (factors = [1, 1.1, 1.32, 1.452]): MonthlyFlows[] =>
  Array.from({ length: 48 }, (_, i) => ({
    month: monthBounds("2026-05-15", i - 48).start.slice(0, 7),
    cashIncome: 1000 * factors[Math.floor(i / 12)],
    stockIncome: 500 * factors[Math.floor(i / 12)],
    cashPayments: 400 * 1.1 ** Math.floor(i / 12),
    stockPayments: 100 * 1.1 ** Math.floor(i / 12),
  }));

describe("annual income trends", () => {
  it("uses complete non-overlapping annual cash-plus-stock totals and geometric YoY growth", () => {
    const result = annualFlowTrends(monthly(), "2026-05-15", 48);
    expect(result.annualWindows.map((value) => value.income)).toEqual([
      18000, 19800, 23760, 26136,
    ]);
    expect(result.annualWindows[0]).toMatchObject({
      start: "2022-05-01",
      end: "2023-04-30",
    });
    expect(result.annualWindows.at(-1)!.end).toBe("2026-04-30");
    expect(result.incomeTrend.comparisons).toBe(3);
    const logs = [1.1, 1.2, 1.1].map(Math.log),
      average = logs.reduce((a, b) => a + b) / 3;
    expect(result.incomeTrend.rate).toBeCloseTo(Math.expm1(average) * 100, 8);
    expect(result.incomeTrend.volatility).toBeCloseTo(
      Math.sqrt(
        logs.reduce((sum, value) => sum + (value - average) ** 2, 0) / 2,
      ) * 100,
      8,
    );
    expect(result.paymentTrend.rate).toBeCloseTo(10, 8);
    expect(result.paymentTrend.volatility).toBeCloseTo(0, 8);
  });
  it("requires 24 months for a growth rate and 36 for its uncertainty", () => {
    const samples = monthly();
    expect(
      annualFlowTrends(samples, "2026-05-15", 12).incomeTrend.rate,
    ).toBeNull();
    const two = annualFlowTrends(samples, "2026-05-15", 24).incomeTrend;
    expect(two.rate).toBeCloseTo(10, 8);
    expect(two.volatility).toBeNull();
    expect(
      annualFlowTrends(samples, "2026-05-15", 36).incomeTrend.volatility,
    ).toBeGreaterThan(0);
  });
  it("rejects partial annual blocks and does not bridge missing years", () => {
    const samples = monthly().filter((sample) => sample.month !== "2023-08");
    const result = annualFlowTrends(samples, "2026-05-15", 48);
    expect(result.annualWindows).toHaveLength(3);
    expect(result.incomeTrend.comparisons).toBe(1);
    expect(result.incomeTrend.rate).toBeCloseTo(10, 8);
    expect(result.incomeTrend.volatility).toBeNull();
  });
  it("withholds geometric income estimates for zero-income years without affecting payments", () => {
    const result = annualFlowTrends(
      monthly([1, 0, 1.32, 1.452]),
      "2026-05-15",
      48,
    );
    expect(result.incomeTrend.reason).toBe("zero_total");
    expect(result.incomeTrend.rate).toBeNull();
    expect(result.incomeTrend.volatility).toBeNull();
    expect(result.paymentTrend.rate).toBeCloseTo(10, 8);
  });
  it("measures stock-only income growth, excluding outgoing stock from income", () => {
    const samples = monthly().map((sample) => ({
      ...sample,
      cashIncome: 0,
      stockPayments: 9000,
    }));
    const result = annualFlowTrends(samples, "2026-05-15", 48);
    expect(result.incomeTrend.rate).toBeCloseTo(
      annualFlowTrends(monthly(), "2026-05-15", 48).incomeTrend.rate!,
      8,
    );
  });
});

describe("projection calibration", () => {
  it("anchors income in the recent year and keeps historical income growth separate from investment returns", () => {
    const data = annualProjectionFixture(),
      before = JSON.stringify(data);
    const result = calibrateProjection(data, "max");
    expect(result.defaults.cashIncome).toBe(1452);
    expect(result.defaults.stockIncome).toBe(726);
    expect(result.defaults.cashPayments).toBeCloseTo(532.4, 8);
    expect(result.defaults.stockPayments).toBeCloseTo(133.1, 8);
    expect(result.baselineMonths).toHaveLength(12);
    expect(result.annualWindows).toHaveLength(4);
    expect(result.defaults.incomeGrowth).toBeCloseTo(13.24, 2);
    expect(result.defaults.incomeVolatility).toBeGreaterThan(0);
    expect(result.defaults.growth).toBeCloseTo((1.0001 ** 365 - 1) * 100, 1);
    expect(JSON.stringify(data)).toBe(before);
  });
  it("Max includes older complete history while using recent baselines", () => {
    const result = calibrateProjection(longProjectionFixture(), "max");
    expect(result.historyMonths).toBe(64);
    expect(result.flowMonths[0]).toBe("2021-01");
    expect(result.returnMonths).toHaveLength(8);
    expect(result.defaults.cashIncome).toBeCloseTo((1000 * 4) / 12);
    expect(result.defaults.stockIncome).toBeCloseTo((500 * 4) / 12);
  });
  it("keeps cash and incoming/outgoing shares separate, excludes the anchor month and does not annualize short income history", () => {
    const result = calibrateProjection(projectionFixture(), 12);
    expect(result.flowMonths).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(result.defaults).toMatchObject({
      cashIncome: 1000,
      stockIncome: 500,
      cashPayments: 400,
      stockPayments: 100,
      incomeGrowth: null,
      incomeVolatility: null,
    });
    expect(result.defaults.growth).not.toBeNull();
  });
  it("counts known zero-flow months and excludes pending, removed, internal and investment activity", () => {
    const fixture = projectionFixture(),
      base = fixture.records[0];
    fixture.records = fixture.records.filter(
      (record) => !record.date.startsWith("2026-01"),
    );
    for (const patch of [
      { status: "pending" },
      { status: "removed" },
      { kind: "internal_transfer" },
      { kind: "ignored" },
    ] as const)
      fixture.records.push({
        ...base,
        ...patch,
        id: JSON.stringify(patch),
        amountCents: 900_000_000,
      });
    const result = calibrateProjection(fixture, 12);
    expect(result.flowMonths).toHaveLength(4);
    expect(result.defaults.cashIncome).toBe(750);
    expect(result.defaults.stockIncome).toBe(375);
  });
  it("requires complete loaded years, unresolved-flow-free months, and daily balances only for investment returns", () => {
    const fixture = annualProjectionFixture();
    fixture.balances.history = [];
    const result = calibrateProjection(fixture, "max");
    expect(result.defaults.incomeGrowth).not.toBeNull();
    expect(result.defaults.growth).toBeNull();
    fixture.records.find((record) => record.date === "2024-08-10")!.status =
      "needs_review";
    expect(calibrateProjection(fixture, "max").incomeTrend.comparisons).toBe(1);
    fixture.coverage = [];
    expect(calibrateProjection(fixture, "max").defaults.cashIncome).toBeNull();
  });
});

describe("compounding forecasts", () => {
  it("compounds both cash and stock income every year, independently of payment growth", () => {
    const settings = { ...assumptions, incomeGrowth: 10, paymentGrowth: 5 };
    expect(projectedMonthlyFlows(settings, 12).income).toBeCloseTo(1650, 8);
    expect(projectedMonthlyFlows(settings, 24).income).toBeCloseTo(1815, 8);
    expect(projectedMonthlyFlows(settings, 24).payments).toBeCloseTo(551.25, 8);
    const result = projectAccountValue(
      10_000_000,
      "2026-05-15",
      2,
      settings,
      80,
    );
    expect(result.incomePoints[12].median).toBeCloseTo(1650, 8);
    expect(result.incomePoints[24].median).toBeCloseTo(1815, 8);
    const expected =
      100000 +
      Array.from(
        { length: 24 },
        (_, i) => projectedMonthlyFlows(settings, i + 1).net,
      ).reduce((a, b) => a + b);
    expect(result.points.at(-1)!.median).toBeCloseTo(expected, 7);
  });
  it("preserves linear contributions at zero growth and matches investment annuity arithmetic", () => {
    const result = projectAccountValue(
      10_000_000,
      "2026-05-15",
      1,
      assumptions,
      80,
    );
    expect(result.points.at(-1)).toMatchObject({
      median: 112000,
      lower: 112000,
      upper: 112000,
    });
    const rate = 1.06 ** (1 / 12) - 1;
    expect(
      projectAccountValue(
        10_000_000,
        "2026-05-15",
        1,
        { ...assumptions, growth: 6 },
        80,
      ).points.at(-1)!.median,
    ).toBeCloseTo(100000 * 1.06 + (1000 * (1.06 - 1)) / rate, 6);
  });
  it("gives income its own positive, widening repeatable range, independent of market volatility", () => {
    const settings = { ...assumptions, incomeGrowth: 5, incomeVolatility: 20 };
    const narrow = projectAccountValue(
      10_000_000,
      "2026-05-15",
      5,
      settings,
      50,
    );
    const wide = projectAccountValue(10_000_000, "2026-05-15", 5, settings, 95);
    const volatile = projectAccountValue(
      10_000_000,
      "2026-05-15",
      5,
      { ...settings, volatility: 30 },
      95,
    );
    expect(wide.incomePoints).toEqual(volatile.incomePoints);
    expect(projectIncome("2026-05-15", 5, settings, 95).incomePoints).toEqual(
      wide.incomePoints,
    );
    expect(
      projectAccountValue(10_000_000, "2026-05-15", 5, settings, 95),
    ).toEqual(wide);
    for (const [i, point] of wide.incomePoints.entries()) {
      expect(point.lower).toBeGreaterThan(0);
      expect(point.lower).toBeLessThanOrEqual(narrow.incomePoints[i].lower);
      expect(point.upper).toBeGreaterThanOrEqual(narrow.incomePoints[i].upper);
      expect(point.median).toBe(narrow.incomePoints[i].median);
    }
    expect(
      wide.incomePoints[60].upper - wide.incomePoints[60].lower,
    ).toBeGreaterThan(
      wide.incomePoints[12].upper - wide.incomePoints[12].lower,
    );
  });
  it("supports declining income, zero income and unfunded shortfalls without compounding debt", () => {
    const result = projectAccountValue(
      100000,
      "2026-01-31",
      1,
      {
        ...assumptions,
        cashIncome: 0,
        stockIncome: 0,
        cashPayments: 200,
        stockPayments: 0,
      },
      80,
    );
    expect(result.shortfallProbability).toBe(1);
    expect(result.points.at(-1)!.median).toBe(-1400);
    expect(result.incomePoints.at(-1)!.median).toBe(0);
    expect(result.points[1].date).toBe("2026-02-28");
    expect(result.points[2].date).toBe("2026-03-31");
    expect(
      projectIncome(
        "2026-01-31",
        1,
        { ...assumptions, incomeGrowth: -10 },
        80,
      ).incomePoints.at(-1)!.median,
    ).toBeCloseTo(1350, 8);
  });
  it("rejects invalid and excessive numeric scenarios instead of hiding overflow", () => {
    for (const patch of [
      { incomeGrowth: -100 },
      { cashIncome: -1 },
      { incomeVolatility: NaN },
      { paymentGrowth: Infinity },
    ])
      expect(() =>
        projectAccountValue(
          100,
          "2026-05-15",
          1,
          { ...assumptions, ...patch },
          80,
        ),
      ).toThrow();
    expect(() =>
      projectAccountValue(
        Number.MAX_SAFE_INTEGER,
        "2026-05-15",
        30,
        { ...assumptions, growth: 100 },
        80,
      ),
    ).toThrow(/supported value range/);
    expect(() =>
      projectAccountValue(100, "2026-05-15", 0, assumptions, 80),
    ).toThrow();
    expect(() =>
      projectAccountValue(100, "2026-05-15", 1, assumptions, 99),
    ).toThrow();
    expect(monthBounds("2024-03-31", -1).end).toBe("2024-02-29");
  });
});
