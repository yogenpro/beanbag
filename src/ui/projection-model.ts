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
  stockIncome: number;
  cashPayments: number;
  stockPayments: number;
  incomeGrowth: number;
  paymentGrowth: number;
  incomeVolatility: number;
  paymentVolatility: number;
  growth: number;
  volatility: number;
};
export type MonthlyFlows = {
  month: string;
  cashIncome: number;
  stockIncome: number;
  cashPayments: number;
  stockPayments: number;
};
export type AnnualWindow = {
  start: string;
  end: string;
  income: number;
  payments: number;
};
export type AnnualTrend = {
  rate: number | null;
  volatility: number | null;
  comparisons: number;
  reason: "insufficient_history" | "zero_total" | null;
};
export type ProjectionCalibration = {
  defaults: { [K in keyof ProjectionAssumptions]: number | null };
  flowMonths: string[];
  returnMonths: string[];
  reconstructed: boolean;
  historyMonths: number;
  flowSamples: MonthlyFlows[];
  baselineMonths: string[];
  annualWindows: AnnualWindow[];
  incomeTrend: AnnualTrend;
  paymentTrend: AnnualTrend;
};
const emptyTrend = (): AnnualTrend => ({
  rate: null,
  volatility: null,
  comparisons: 0,
  reason: "insufficient_history",
});

/** Non-overlapping complete 12-month blocks aligned with the anchor's month.
 * Only adjacent blocks can produce a YoY comparison. Missing months and zero
 * totals never become an invented growth observation.
 */
export function annualFlowTrends(
  samples: MonthlyFlows[],
  anchor: string,
  lookback: number,
) {
  const byMonth = new Map(samples.map((sample) => [sample.month, sample]));
  const annualWindows: AnnualWindow[] = [];
  for (
    let offset = -Math.floor(lookback / 12) * 12;
    offset <= -12;
    offset += 12
  ) {
    const block = Array.from({ length: 12 }, (_, i) =>
      byMonth.get(monthBounds(anchor, offset + i).start.slice(0, 7)),
    );
    if (block.some((sample) => !sample)) continue;
    annualWindows.push({
      start: monthBounds(anchor, offset).start,
      end: monthBounds(anchor, offset + 11).end,
      income: block.reduce(
        (sum, sample) => sum + sample!.cashIncome + sample!.stockIncome,
        0,
      ),
      payments: block.reduce(
        (sum, sample) => sum + sample!.cashPayments + sample!.stockPayments,
        0,
      ),
    });
  }
  const trend = (key: "income" | "payments"): AnnualTrend => {
    const logs: number[] = [];
    let zero = false;
    for (let i = 1; i < annualWindows.length; i++) {
      const previous = annualWindows[i - 1],
        current = annualWindows[i];
      if (iso(new Date(Date.parse(previous.end) + day)) !== current.start)
        continue;
      if (previous[key] <= 0 || current[key] <= 0) {
        zero = true;
        continue;
      }
      logs.push(Math.log(current[key] / previous[key]));
    }
    if (zero)
      return {
        ...emptyTrend(),
        comparisons: logs.length,
        reason: "zero_total",
      };
    return {
      rate: logs.length ? Math.expm1(mean(logs)) * 100 : null,
      volatility: logs.length >= 2 ? deviation(logs) * 100 : null,
      comparisons: logs.length,
      reason: logs.length >= 2 ? null : "insufficient_history",
    };
  };
  return {
    annualWindows,
    incomeTrend: trend("income"),
    paymentTrend: trend("payments"),
  };
}

export function projectedMonthlyFlows(
  assumptions: ProjectionAssumptions,
  month: number,
) {
  const incomeFactor = (1 + assumptions.incomeGrowth / 100) ** (month / 12);
  const paymentFactor = (1 + assumptions.paymentGrowth / 100) ** (month / 12);
  const income =
    (assumptions.cashIncome + assumptions.stockIncome) * incomeFactor;
  const payments =
    (assumptions.cashPayments + assumptions.stockPayments) * paymentFactor;
  return { income, payments, net: income - payments };
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
      stockIncome: null,
      stockPayments: null,
      incomeGrowth: null,
      paymentGrowth: null,
      incomeVolatility: null,
      paymentVolatility: null,
      growth: null,
      volatility: null,
    },
    flowMonths: [],
    returnMonths: [],
    reconstructed: false,
    historyMonths: 0,
    flowSamples: [],
    baselineMonths: [],
    annualWindows: [],
    incomeTrend: emptyTrend(),
    paymentTrend: emptyTrend(),
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
      month: period.start.slice(0, 7),
      stockIncome: total("stock_income"),
      stockPayments: total("stock_spending"),
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
  // Anchor the forecast in the most recent usable year, not a multi-year average
  // that would dilute an already-growing income stream.
  const recent = result.flowSamples.slice(-12);
  result.baselineMonths = recent.map((sample) => sample.month);
  if (recent.length >= 3) {
    for (const key of [
      "cashIncome",
      "stockIncome",
      "cashPayments",
      "stockPayments",
    ] as const)
      result.defaults[key] = mean(recent.map((sample) => sample[key]));
  }
  Object.assign(result, annualFlowTrends(result.flowSamples, anchor, months));
  result.defaults.incomeGrowth = result.incomeTrend.rate;
  result.defaults.incomeVolatility = result.incomeTrend.volatility;
  result.defaults.paymentGrowth = result.paymentTrend.rate;
  result.defaults.paymentVolatility = result.paymentTrend.volatility;
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
  stockIncome: [0, 1_000_000],
  stockPayments: [0, 1_000_000],
  incomeGrowth: [-90, 200],
  paymentGrowth: [-90, 200],
  incomeVolatility: [0, 100],
  paymentVolatility: [0, 100],
  growth: [-90, 100],
  volatility: [0, 100],
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
  incomePoints: ProjectionPoint[];
  shortfallProbability: number;
};

/** Income forecasts do not require investment-return or expense assumptions. */
export function projectIncome(
  anchor: string,
  years: number,
  assumptions: Pick<
    ProjectionAssumptions,
    "cashIncome" | "stockIncome" | "incomeGrowth" | "incomeVolatility"
  >,
  confidence: number,
): Projection {
  const result = projectAccountValue(
    0,
    anchor,
    years,
    {
      ...assumptions,
      cashPayments: 0,
      stockPayments: 0,
      paymentGrowth: 0,
      paymentVolatility: 0,
      growth: 0,
      volatility: 0,
    },
    confidence,
  );
  return {
    points: [],
    incomePoints: result.incomePoints,
    shortfallProbability: 0,
  };
}

/** Seeded Monte Carlo: monthly investment returns plus independently sampled
 * annual income/payment log growth, compounded monthly and paid at month-end. Values are dollars (forecast estimates,
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
  const incomes = Array.from(
    { length: count },
    () => assumptions.cashIncome + assumptions.stockIncome,
  );
  const payments = Array.from(
    { length: count },
    () => assumptions.cashPayments + assumptions.stockPayments,
  );
  const incomeFactors = Array<number>(count).fill(1),
    paymentFactors = Array<number>(count).fill(1);
  const incomePoints: ProjectionPoint[] = [
    {
      month: 0,
      date: anchor,
      median: incomes[0],
      lower: incomes[0],
      upper: incomes[0],
    },
  ];
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
      if ((month - 1) % 12 === 0) {
        incomeFactors[path] = Math.exp(
          (Math.log1p(assumptions.incomeGrowth / 100) +
            (assumptions.incomeVolatility / 100) * normal()) /
            12,
        );
        paymentFactors[path] = Math.exp(
          (Math.log1p(assumptions.paymentGrowth / 100) +
            (assumptions.paymentVolatility / 100) * normal()) /
            12,
        );
      }
      incomes[path] *= incomeFactors[path];
      payments[path] *= paymentFactors[path];
      paths[path] +=
        Math.max(0, paths[path]) * Math.expm1(drift + sigma * normal()) +
        incomes[path] -
        payments[path];
      if (
        [paths[path], incomes[path], payments[path]].some(
          (value) =>
            !Number.isFinite(value) ||
            Math.abs(value) > Number.MAX_SAFE_INTEGER / 100,
        )
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
    const sortedIncomes = [...incomes].sort((a, b) => a - b);
    incomePoints.push({
      month,
      date: iso(date),
      median: quantile(sortedIncomes, 0.5),
      lower: quantile(sortedIncomes, tail),
      upper: quantile(sortedIncomes, 1 - tail),
    });
    points.push({
      month,
      date: iso(date),
      median: quantile(sorted, 0.5),
      lower: quantile(sorted, tail),
      upper: quantile(sorted, 1 - tail),
    });
  }
  return { points, incomePoints, shortfallProbability: shortfall.size / count };
}
