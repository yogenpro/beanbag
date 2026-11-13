import { describe, expect, it } from "vitest";
import { periodOptions, rollingPeriod } from "../src/ui/periods";
import { createApp } from "../src/api/app";
import { demoLedger } from "../src/data/demo";
import type { Dashboard } from "../src/ui/api";

const now = new Date("2026-11-12T20:00:00Z");
const available = { start: "2024-11-13", end: "2026-11-13" };

describe("reporting ranges", () => {
  it("uses inclusive rolling calendar-month dates and clamps shorter months", () => {
    expect(rollingPeriod(1, now)).toEqual({
      start: "2026-10-12",
      end: "2026-11-12",
    });
    expect(rollingPeriod(3, now).start).toBe("2026-08-12");
    expect(rollingPeriod(6, now).start).toBe("2026-05-12");
    expect(rollingPeriod(1, new Date("2024-03-31T20:00:00Z"))).toEqual({
      start: "2024-02-29",
      end: "2024-03-31",
    });
    expect(rollingPeriod(1, new Date("2026-03-31T20:00:00Z")).start).toBe(
      "2026-02-28",
    );
  });
  it("uses Pacific dates across UTC midnight, daylight saving and year boundaries", () => {
    expect(rollingPeriod(3, new Date("2026-01-01T02:00:00Z"))).toEqual({
      start: "2025-09-30",
      end: "2025-12-31",
    });
    expect(rollingPeriod(1, new Date("2026-11-02T07:30:00Z"))).toEqual({
      start: "2026-10-01",
      end: "2026-11-01",
    });
  });
  it("offers months and quarters across years while capping the current period at today", () => {
    const months = periodOptions("month", available, now);
    expect(months.find((option) => option.value === "2024-11")?.period).toEqual(
      { start: "2024-11-01", end: "2024-11-30" },
    );
    expect(
      months.find((option) => option.value === "2026-11")?.period.end,
    ).toBe("2026-11-12");
    const quarters = periodOptions("quarter", available, now);
    expect(quarters[0].period).toEqual(rollingPeriod(3, now));
    expect(
      quarters.find((option) => option.value === "2025-Q1")?.period,
    ).toEqual({ start: "2025-01-01", end: "2025-03-31" });
    expect(
      quarters.find((option) => option.value === "2026-Q4")?.period.end,
    ).toBe("2026-11-12");
    expect(quarters.some((option) => option.value === "2026-Q5")).toBe(false);
  });
  it("offers exact calendar half-years alongside a rolling six months", () => {
    const halves = periodOptions("half", available, now);
    expect(halves[0].period).toEqual(rollingPeriod(6, now));
    expect(halves.find((option) => option.value === "2025-H2")?.period).toEqual(
      { start: "2025-07-01", end: "2025-12-31" },
    );
    expect(halves.find((option) => option.value === "2026-H1")?.period).toEqual(
      { start: "2026-01-01", end: "2026-06-30" },
    );
  });
  it("compares year-to-date through the same calendar day, clamping leap days", () => {
    expect(
      periodOptions("ytd", available, now).find(
        (option) => option.value === "2025",
      )?.period,
    ).toEqual({ start: "2025-01-01", end: "2025-11-12" });
    expect(
      periodOptions("ytd", available, new Date("2024-02-29T20:00:00Z")).find(
        (option) => option.value === "2023",
      )?.period.end,
    ).toBe("2023-02-28");
  });
  it("defaults last year to the previous complete calendar year and Max to every available date", () => {
    expect(periodOptions("year", available, now)[0].period).toEqual({
      start: "2025-01-01",
      end: "2025-12-31",
    });
    expect(periodOptions("max", available, now)[0].period).toEqual(available);
    expect(periodOptions("max", undefined, now)[0].period).toEqual({
      start: "2026-11-12",
      end: "2026-11-12",
    });
  });
  it("exposes the complete saved range independently of a narrow report and filters every chart to its period", async () => {
    const repo = demoLedger(now),
      app = createApp({ demo: repo });
    repo.historicalValues.push({
      accountId: repo.selected[0].id,
      date: "2024-01-01",
      calculatedAt: now.toISOString(),
      method: "plaid_assets",
      netValueCents: 10000,
      assetsCents: 10000,
      borrowingCents: 0,
      source: "Invented checking history",
    });
    const env = {
      LOCAL_DEMO: "true",
      ASSETS: {
        fetch: async () => new Response("invented"),
      } as unknown as Fetcher,
    };
    const narrow = (await (
      await app.request(
        "http://localhost/api/report?start=2026-11-01&end=2026-11-12",
        {},
        env,
      )
    ).json()) as Dashboard;
    expect(narrow.availablePeriod.start).toBe("2024-01-01");
    expect(narrow.trend.every((row) => row.month === "2026-11")).toBe(true);
    const broad = (await (
      await app.request(
        `http://localhost/api/report?start=${narrow.availablePeriod.start}&end=${narrow.availablePeriod.end}`,
        {},
        env,
      )
    ).json()) as Dashboard;
    expect(broad.availablePeriod).toEqual(narrow.availablePeriod);
    expect(broad.balances.latest).toEqual(narrow.balances.latest);
    expect(broad.balances.history.length).toBeGreaterThan(
      narrow.balances.history.length,
    );
  });
});
