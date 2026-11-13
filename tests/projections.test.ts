import { describe, expect, it } from "vitest";
import {
  calibrateProjection,
  monthBounds,
  projectAccountValue,
  type ProjectionAssumptions,
} from "../src/ui/projection-model";
import {
  longProjectionFixture,
  projectionFixture,
} from "./projection-fixtures";

const assumptions: ProjectionAssumptions = {
  cash: 600,
  shares: 400,
  growth: 0,
  volatility: 0,
  flowDeviation: 0,
};
describe("browser-only projection estimates", () => {
  it("Max includes covered months and daily returns older than five years", () => {
    const fixture = longProjectionFixture();
    const fiveYears = calibrateProjection(fixture, 60);
    const max = calibrateProjection(fixture, "max");
    expect(fiveYears.historyMonths).toBe(60);
    expect(max.historyMonths).toBe(64);
    expect(max.flowMonths).toHaveLength(64);
    expect(max.flowMonths[0]).toBe("2021-01");
    expect(max.returnMonths).toHaveLength(8);
    expect(max.returnMonths[0]).toBe("2021-01");
    expect(fiveYears.returnMonths).toHaveLength(4);
    expect(fiveYears.defaults.cash).toBe(40);
    expect(max.defaults.cash).toBe(75);
    expect(max.defaults.shares).toBe(50);
    expect(max.flowMonths.at(-1)).toBe("2026-04");
  });
  it("Max handles missing coverage and a start within the anchor month without invented estimates", () => {
    const fixture = projectionFixture();
    fixture.coverage = [];
    expect(calibrateProjection(fixture, "max").defaults.cash).toBeNull();
    fixture.availablePeriod.start = "2026-05-01";
    const result = calibrateProjection(fixture, "max");
    expect(result.historyMonths).toBe(0);
    expect(result.flowMonths).toEqual([]);
    expect(result.returnMonths).toEqual([]);
  });
  it("separates external cash and shares, compounds flow-adjusted returns, and excludes the anchor month", () => {
    const result = calibrateProjection(projectionFixture(), 12);
    expect(result.flowMonths).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(result.returnMonths).toEqual(result.flowMonths);
    expect(result.defaults.cash).toBe(600);
    expect(result.defaults.shares).toBe(400);
    expect(result.defaults.flowDeviation).toBe(0);
    const logs = [0.01, -0.005, 0.02, 0.015].map(Math.log1p);
    const mean = logs.reduce((a, b) => a + b) / 4;
    expect(result.defaults.growth).toBeCloseTo(Math.expm1(mean * 12) * 100, 3);
    expect(result.defaults.volatility).toBeCloseTo(
      Math.sqrt(logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 3) *
        Math.sqrt(12) *
        100,
      3,
    );
  });
  it("includes known zero-flow months while ignoring pending, removed, internal and investment activity", () => {
    const fixture = projectionFixture();
    const base = fixture.records[0];
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
    expect(result.defaults.cash).toBe(450);
    expect(result.defaults.shares).toBe(300);
    expect(result.defaults.flowDeviation).toBe(500);
  });
  it("withholds return estimates for gaps independently of contribution estimates", () => {
    const fixture = projectionFixture();
    fixture.balances.history = fixture.balances.history.filter(
      (point) => !["2026-01-31", "2026-04-10"].includes(point.date),
    );
    const result = calibrateProjection(fixture, 12);
    expect(result.defaults.cash).toBe(600);
    expect(result.returnMonths).toEqual(["2026-03"]);
    expect(result.defaults.growth).toBeNull();
    expect(result.defaults.volatility).toBeNull();
  });
  it("excludes unresolved and partially covered months instead of inventing zero observations", () => {
    const fixture = projectionFixture();
    fixture.records[0].status = "needs_review";
    fixture.coverage[0].history!.start = "2026-02-15";
    const result = calibrateProjection(fixture, 12);
    expect(result.flowMonths).toEqual(["2026-03", "2026-04"]);
    expect(
      Object.values(result.defaults).every((value) => value === null),
    ).toBe(true);
  });
  it("accepts reconstructed daily values with explicit provenance and does not mutate source data", () => {
    const fixture = projectionFixture();
    fixture.balances.history[10].historyMethods = ["reconstructed"];
    const before = JSON.stringify(fixture);
    expect(calibrateProjection(fixture, 12).reconstructed).toBe(true);
    expect(JSON.stringify(fixture)).toBe(before);
  });
});
describe("future value simulation", () => {
  it("matches closed-form constant contributions and growth without uncertainty", () => {
    const linear = projectAccountValue(
      10_000_000,
      "2026-05-15",
      1,
      assumptions,
      80,
    );
    expect(linear.points[0].median).toBe(100_000);
    expect(linear.points.at(-1)).toMatchObject({
      median: 112_000,
      lower: 112_000,
      upper: 112_000,
      date: "2027-05-15",
    });
    const rate = 1.06 ** (1 / 12) - 1;
    const compound = projectAccountValue(
      10_000_000,
      "2026-05-15",
      1,
      { ...assumptions, growth: 6 },
      80,
    );
    expect(compound.points.at(-1)!.median).toBeCloseTo(
      100_000 * 1.06 + (1000 * (1.06 - 1)) / rate,
      6,
    );
  });
  it("uses repeatable paths, ordered percentiles, and wider ranges for higher coverage", () => {
    const settings = { ...assumptions, volatility: 18, flowDeviation: 500 };
    const narrow = projectAccountValue(
      10_000_000,
      "2026-05-15",
      5,
      settings,
      50,
    );
    const wide = projectAccountValue(10_000_000, "2026-05-15", 5, settings, 95);
    expect(
      projectAccountValue(10_000_000, "2026-05-15", 5, settings, 50),
    ).toEqual(narrow);
    for (const [i, point] of wide.points.entries()) {
      expect(point.lower).toBeLessThanOrEqual(narrow.points[i].lower);
      expect(point.upper).toBeGreaterThanOrEqual(narrow.points[i].upper);
      expect(point.median).toBe(narrow.points[i].median);
    }
  });
  it("represents depletion as a shortfall without compounding debt or flooring it away", () => {
    const result = projectAccountValue(
      100_000,
      "2026-01-31",
      1,
      { ...assumptions, cash: -200, shares: 0 },
      80,
    );
    expect(result.shortfallProbability).toBe(1);
    expect(result.points.at(-1)!.median).toBe(-1400);
    expect(result.points[1].date).toBe("2026-02-28");
    expect(result.points[2].date).toBe("2026-03-31");
    expect(
      projectAccountValue(-100, "2026-01-31", 1, assumptions, 80)
        .shortfallProbability,
    ).toBe(1);
    expect(monthBounds("2024-03-31", -1).end).toBe("2024-02-29");
  });
  it("rejects invalid parameters and excessive numeric results", () => {
    for (const growth of [NaN, Infinity, -100, 101])
      expect(() =>
        projectAccountValue(
          100,
          "2026-05-15",
          1,
          { ...assumptions, growth },
          80,
        ),
      ).toThrow();
    expect(() =>
      projectAccountValue(100, "2026-05-15", 0, assumptions, 80),
    ).toThrow();
    expect(() =>
      projectAccountValue(100, "2026-05-15", 1, assumptions, 99),
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
  });
});
