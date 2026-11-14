import { transactionCoverage } from "../accounting/coverage";
import { accountValueChange } from "../accounting/value-change";
import type { Dashboard } from "./api";

const day = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
const deviation = (values: number[]) => {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, n) => sum + (n - average) ** 2, 0) /
      (values.length - 1),
  );
};
export function monthBounds(anchor: string, offset: number) {
  const date = new Date(anchor + "T00:00:00Z");
  return {
    start: iso(
      new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)),
    ),
    end: iso(
      new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset + 1, 0),
      ),
    ),
  };
}
export type ProjectionAssumptions = {
  cashIncome: number;
  cashPayments: number;
  incomeScale: number;
  paymentScale: number;
  shares: number;
  growth: number;
  volatility: number;
  flowDeviation: number;
};
export type ProjectionCalibration = {
  defaults: { [K in keyof ProjectionAssumptions]: number | null };
  flowMonths: string[];
  returnMonths: string[];
  reconstructed: boolean;
  historyMonths: number;
  flowSamples: { cashIncome: number; cashPayments: number; shares: number }[];
};

export function projectedCashFlow(
  assumptions: Pick<
    ProjectionAssumptions,
    "cashIncome" | "cashPayments" | "incomeScale" | "paymentScale"
  >,
) {
  const income = (assumptions.cashIncome * assumptions.incomeScale) / 100;
  const payments = (assumptions.cashPayments * assumptions.paymentScale) / 100;
  return { income, payments, net: income - payments };
}

/** Scale each month's actual components before computing net variability.
 * This retains their historical covariance instead of adding independent noise.
 */
export function scaledContributionDeviation(
  calibration: ProjectionCalibration | null,
  incomeScale: number,
  paymentScale: number,
): number | null {
  if (
    !calibration ||
    calibration.flowSamples.length < 3 ||
    !Number.isFinite(incomeScale) ||
    !Number.isFinite(paymentScale)
  )
    return null;
  return deviation(
    calibration.flowSamples.map(
      (sample) =>
        projectedCashFlow({ ...sample, incomeScale, paymentScale }).net +
        sample.shares,
    ),
  );
}

export type ProjectionLookback = number | "max";

/** Complete calendar months only; absent months are never silently zero-filled.
 * The anchor month is excluded, even when its last observation is month-end.
 * Return estimates use the ledger's existing daily capital-flow convention.
 */
export function calibrateProjection(
  data: Dashboard,
  lookback: ProjectionLookback,
): ProjectionCalibration {
  const result: ProjectionCalibration = {
    defaults: {
      cashIncome: null,
      cashPayments: null,
      incomeScale: 100,
      paymentScale: 100,
      shares: null,
      growth: null,
      volatility: null,
      flowDeviation: null,
    },
    flowMonths: [],
    returnMonths: [],
    reconstructed: false,
    historyMonths: 0,
    flowSamples: [],
  };
  const anchor = data.balances.latest?.date;
  if (!anchor) return result;
  const monthIndex = (date: string) =>
    Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  // Before the common loaded transaction window, neither contributions nor
  // flow-adjusted returns can be estimated. Avoid treating earlier gaps as zero.
  const historyStart =
    transactionCoverage(data.coverage, data.availablePeriod).start ??
    data.availablePeriod.start;
  const months =
    lookback === "max"
      ? Math.max(0, monthIndex(anchor) - monthIndex(historyStart))
      : lookback;
  result.historyMonths = months;
  const logs: number[] = [];
  const ids = new Set(data.accounts.map((account) => account.id));
  for (let offset = -months; offset < 0; offset++) {
    const period = monthBounds(anchor, offset);
    if (transactionCoverage(data.coverage, period).status !== "available")
      continue;
    const records = data.records.filter(
      (record) =>
        ids.has(record.accountId) &&
        record.date >= period.start &&
        record.date <= period.end,
    );
    if (
      records.some(
        (record) =>
          record.status === "needs_review" ||
          (record.status === "confirmed" &&
            (record.kind === "unknown" ||
              ([
                "cash_income",
                "stock_income",
                "spending",
                "stock_spending",
              ].includes(record.kind) &&
                record.amountCents === null))),
      )
    )
      continue;
    const total = (kind: string) =>
      records
        .filter(
          (record) => record.status === "confirmed" && record.kind === kind,
        )
        .reduce((sum, record) => sum + record.amountCents!, 0) / 100;
    result.flowSamples.push({
      cashIncome: total("cash_income"),
      cashPayments: total("spending"),
      shares: total("stock_income") - total("stock_spending"),
    });
    result.flowMonths.push(period.start.slice(0, 7));
    const opening = iso(new Date(Date.parse(period.start) - day));
    // Require exact month boundaries; accountValueChange otherwise permits a shorter window.
    if (
      !data.balances.history.some(
        (point) => point.date === opening && point.netWorthCents !== null,
      ) ||
      !data.balances.history.some(
        (point) => point.date === period.end && point.netWorthCents !== null,
      )
    )
      continue;
    const change = accountValueChange(
      data.balances.history,
      data.records,
      data.accounts,
      data.coverage,
      period,
    );
    const twr = change.timeWeightedReturn;
    if (twr.status !== "estimated" || twr.rate === null || twr.rate <= -1)
      continue;
    logs.push(Math.log1p(twr.rate));
    result.returnMonths.push(period.start.slice(0, 7));
    result.reconstructed ||= twr.usesReconstructedValues;
  }
  if (result.flowSamples.length >= 3) {
    result.defaults.cashIncome = mean(
      result.flowSamples.map((sample) => sample.cashIncome),
    );
    result.defaults.cashPayments = mean(
      result.flowSamples.map((sample) => sample.cashPayments),
    );
    result.defaults.shares = mean(
      result.flowSamples.map((sample) => sample.shares),
    );
    result.defaults.flowDeviation = scaledContributionDeviation(
      result,
      100,
      100,
    );
  }
  if (logs.length >= 3) {
    result.defaults.growth = Math.expm1(mean(logs) * 12) * 100;
    result.defaults.volatility = deviation(logs) * Math.sqrt(12) * 100;
  }
  return result;
}

export const assumptionLimits: Record<
  keyof ProjectionAssumptions,
  [number, number]
> = {
  cashIncome: [0, 1_000_000],
  cashPayments: [0, 1_000_000],
  incomeScale: [0, 1000],
  paymentScale: [0, 1000],
  shares: [-1_000_000, 1_000_000],
  growth: [-90, 100],
  volatility: [0, 100],
  flowDeviation: [0, 1_000_000],
};
export type ProjectionPoint = {
  month: number;
  date: string;
  median: number;
  lower: number;
  upper: number;
};
export type Projection = {
  points: ProjectionPoint[];
  shortfallProbability: number;
};

/** Seeded Monte Carlo: monthly normal log returns and independent normal net
 * contributions, paid at month-end. Values are dollars (forecast estimates,
 * never source-ledger amounts). Below zero represents an unfunded shortfall;
 * growth applies to positive balances only, with no invented borrowing rate.
 */
export function projectAccountValue(
  startCents: number,
  anchor: string,
  years: number,
  assumptions: ProjectionAssumptions,
  confidence: number,
): Projection {
  if (
    !Number.isSafeInteger(startCents) ||
    !Number.isFinite(Date.parse(anchor)) ||
    !Number.isInteger(years) ||
    years < 1 ||
    years > 30 ||
    ![50, 80, 95].includes(confidence) ||
    Object.entries(assumptionLimits).some(([key, [min, max]]) => {
      const value = assumptions[key as keyof ProjectionAssumptions];
      return !Number.isFinite(value) || value < min || value > max;
    })
  )
    throw new Error("Projection inputs are outside supported limits.");
  let seed = 20261113;
  const uniform = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  const normal = () =>
    Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
  const count = 1000,
    months = years * 12;
  const paths = Array.from({ length: count }, () => startCents / 100);
  const shortfall = new Set<number>(
    startCents < 0 ? paths.map((_, i) => i) : [],
  );
  const points: ProjectionPoint[] = [
    {
      month: 0,
      date: anchor,
      median: startCents / 100,
      lower: startCents / 100,
      upper: startCents / 100,
    },
  ];
  const drift = Math.log1p(assumptions.growth / 100) / 12;
  const monthlyCash = projectedCashFlow(assumptions);
  const sigma = assumptions.volatility / 100 / Math.sqrt(12);
  const tail = (1 - confidence / 100) / 2;
  const quantile = (sorted: number[], fraction: number) => {
    const position = (sorted.length - 1) * fraction,
      index = Math.floor(position);
    return (
      sorted[index] +
      (sorted[Math.min(index + 1, sorted.length - 1)] - sorted[index]) *
        (position - index)
    );
  };
  const start = new Date(anchor + "T00:00:00Z");
  for (let month = 1; month <= months; month++) {
    for (let path = 0; path < count; path++) {
      paths[path] +=
        Math.max(0, paths[path]) * Math.expm1(drift + sigma * normal()) +
        monthlyCash.net +
        assumptions.shares +
        assumptions.flowDeviation * normal();
      if (
        !Number.isFinite(paths[path]) ||
        Math.abs(paths[path]) > Number.MAX_SAFE_INTEGER / 100
      )
        throw new Error(
          "This scenario exceeds the supported value range. Reduce the horizon or assumptions.",
        );
      if (paths[path] < 0) shortfall.add(path);
    }
    const date = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, 1),
    );
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(start.getUTCDate(), lastDay));
    const sorted = [...paths].sort((a, b) => a - b);
    points.push({
      month,
      date: iso(date),
      median: quantile(sorted, 0.5),
      lower: quantile(sorted, tail),
      upper: quantile(sorted, 1 - tail),
    });
  }
  return { points, shortfallProbability: shortfall.size / count };
}
