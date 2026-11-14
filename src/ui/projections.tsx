import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { api, displayDate, money, type Dashboard } from "./api";
import {
  assumptionLimits,
  calibrateProjection,
  projectAccountValue,
  projectIncome,
  projectedMonthlyFlows,
  type ProjectionAssumptions,
  type ProjectionPoint,
  type ProjectionLookback,
} from "./projection-model";

export type ProjectionSettings = {
  lookback: ProjectionLookback;
  years: number;
  confidence: number;
  overrides: Partial<Record<keyof ProjectionAssumptions, string>>;
};
export const initialProjectionSettings: ProjectionSettings = {
  lookback: "max",
  years: 10,
  confidence: 80,
  overrides: {},
};
const amount = (dollars: number) => money(Math.round(dollars * 100));
const compact = (dollars: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(dollars);
type ProjectionField = {
  key: keyof ProjectionAssumptions;
  label: string;
  unit: string;
  help: string;
  defaultLabel?: string;
};
const fields: ProjectionField[] = [
  {
    key: "cashIncome",
    label: "Monthly cash income",
    unit: "$ / month",
    help: "Recent average external cash receipts at the start of the forecast.",
  },
  {
    key: "stockIncome",
    label: "Monthly stock income",
    unit: "$ / month",
    help: "Incoming external shares at their saved transfer values, before any outflows.",
  },
  {
    key: "incomeGrowth",
    label: "Annual income growth",
    unit: "% / year",
    help: "Compounds cash and stock income every year. 5% means 1.05× after one year, 1.1025× after two.",
  },
  {
    key: "incomeVolatility",
    label: "Annual income uncertainty",
    unit: "% log growth",
    help: "Historical variation in year-over-year income growth; controls the income outcome band.",
  },
  {
    key: "cashPayments",
    label: "Monthly cash payments",
    unit: "$ / month",
    help: "Recent average external cash payments, entered as a positive amount.",
  },
  {
    key: "stockPayments",
    label: "Monthly stock outflows",
    unit: "$ / month",
    help: "Outgoing external shares at saved transfer values; treated as expenses.",
  },
  {
    key: "paymentGrowth",
    label: "Annual payment growth",
    unit: "% / year",
    help: "Compounds cash payments and stock outflows separately from income.",
  },
  {
    key: "paymentVolatility",
    label: "Annual payment uncertainty",
    unit: "% log growth",
    help: "Historical variation in year-over-year external expenses.",
  },
  {
    key: "growth",
    label: "Annual investment growth",
    unit: "% / year",
    help: "Geometric growth of account value after external flows; independent of income growth.",
  },
  {
    key: "volatility",
    label: "Annual return volatility",
    unit: "% / year",
    help: "Standard deviation of investment log returns; controls market uncertainty.",
  },
];

function AssumptionField({
  field,
  historical,
  override,
  invalid,
  onChange,
}: {
  field: ProjectionField;
  historical: number | null | undefined;
  override: string | undefined;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const [min, max] = assumptionLimits[field.key];
  const outsideLimits =
    historical != null && (historical < min || historical > max);
  return (
    <div className="projection-field">
      <label htmlFor={`projection-${field.key}`}>
        {field.label}
        <span>{field.unit}</span>
      </label>
      <input
        id={`projection-${field.key}`}
        type="number"
        step="any"
        min={min}
        max={max}
        value={
          override ??
          (historical == null ? "" : Number(historical.toFixed(2)).toString())
        }
        placeholder="Enter assumption"
        aria-invalid={invalid}
        aria-describedby={`projection-${field.key}-help`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`projection-${field.key}-help`}>{field.help}</p>
      <span className="projection-source">
        {override !== undefined
          ? "Your assumption"
          : outsideLimits
            ? "History estimate outside supported limits; enter an assumption"
            : historical == null
              ? "Insufficient usable history"
              : (field.defaultLabel ?? "Estimated from history")}
      </span>
      <span className="projection-limit">
        Supported: {min.toLocaleString()} to {max.toLocaleString()}
      </span>
    </div>
  );
}

function ProjectionChart({
  points,
  confidence,
  metric = "account value",
}: {
  points: ProjectionPoint[];
  confidence: number;
  metric?: "account value" | "monthly income";
}) {
  const [month, setMonth] = useState(points.length - 1);
  const chart = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(960);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setChartWidth(entry.contentRect.width),
    );
    observer.observe(chart.current!);
    return () => observer.disconnect();
  }, []);
  const selected = points[Math.min(month, points.length - 1)];
  const width = Math.max(240, Math.min(960, chartWidth)),
    height = width < 600 ? 280 : 340,
    left = width < 600 ? 64 : 76,
    right = width < 600 ? 16 : 24,
    top = 24,
    bottom = 44;
  const min = Math.min(0, ...points.map((point) => point.lower));
  const rawMax = Math.max(0, ...points.map((point) => point.upper));
  const spread = Math.max(1, rawMax - min),
    max = rawMax + spread * 0.08;
  const x = (i: number) =>
    left + (i / (points.length - 1)) * (width - left - right);
  const y = (value: number) =>
    height -
    bottom -
    ((value - min) / (max - min || 1)) * (height - top - bottom);
  const line = (key: "median" | "lower" | "upper") =>
    points
      .map((point, i) => `${i ? "L" : "M"}${x(i)},${y(point[key])}`)
      .join(" ");
  const band =
    line("upper") +
    " " +
    [...points]
      .reverse()
      .map((point, i) => `L${x(points.length - 1 - i)},${y(point.lower)}`)
      .join(" ") +
    " Z";
  const ticks = Array.from(
    { length: 5 },
    (_, i) => min + ((max - min) * i) / 4,
  );
  return (
    <>
      <div className="projection-readout" aria-live="polite" aria-atomic="true">
        <span>{displayDate(selected.date)}</span>
        <strong>
          {amount(selected.median)}{" "}
          <span>median{metric === "monthly income" ? " / month" : ""}</span>
        </strong>
        <span>
          {confidence}% range: {amount(selected.lower)} to{" "}
          {amount(selected.upper)}
        </span>
      </div>
      <div className="projection-chart" ref={chart}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Projected ${metric} with a ${confidence}% modeled outcome range`}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const position =
              ((event.clientX - bounds.left) / bounds.width) * width;
            setMonth(
              Math.max(
                0,
                Math.min(
                  points.length - 1,
                  Math.round(
                    ((position - left) / (width - left - right)) *
                      (points.length - 1),
                  ),
                ),
              ),
            );
          }}
        >
          <title>Future {metric}</title>
          <desc>
            A solid line shows the median of 1,000 simulated paths. The shaded
            area shows the central {confidence}% of outcomes at each month. Use
            the month slider or annual table for exact values.
          </desc>
          {ticks.map((tick, i) => (
            <g key={i}>
              <line
                x1={left}
                x2={width - right}
                y1={y(tick)}
                y2={y(tick)}
                className="projection-grid"
              />
              <text x={left - 12} y={y(tick) + 4} textAnchor="end">
                {compact(tick)}
              </text>
            </g>
          ))}
          {min < 0 && (
            <line
              x1={left}
              x2={width - right}
              y1={y(0)}
              y2={y(0)}
              className="projection-zero"
            />
          )}
          <path d={band} className="projection-band" />
          <path d={line("median")} className="projection-median" />
          {[0, Math.round((points.length - 1) / 2), points.length - 1].map(
            (i) => (
              <text
                key={i}
                x={x(i)}
                y={height - 12}
                textAnchor={
                  i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
                }
              >
                {width < 600
                  ? new Date(points[i].date + "T12:00:00Z").toLocaleDateString(
                      "en-US",
                      { month: "short", year: "numeric", timeZone: "UTC" },
                    )
                  : displayDate(points[i].date)}
              </text>
            ),
          )}
          <line
            x1={x(selected.month)}
            x2={x(selected.month)}
            y1={top}
            y2={height - bottom}
            className="projection-cursor"
          />
          <circle
            cx={x(selected.month)}
            cy={y(selected.median)}
            r={5}
            className="projection-dot"
          />
        </svg>
      </div>
      <label className="projection-scrubber">
        <span>Inspect forecast month</span>
        <input
          type="range"
          min={0}
          max={points.length - 1}
          value={Math.min(month, points.length - 1)}
          aria-valuetext={`${displayDate(selected.date)}, median ${amount(selected.median)}`}
          onChange={(event) => setMonth(Number(event.target.value))}
        />
      </label>
    </>
  );
}

export function Projections({
  data,
  settings,
  onChange,
}: {
  data: Dashboard;
  settings: ProjectionSettings;
  onChange: (settings: ProjectionSettings) => void;
}) {
  const [history, setHistory] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<"value" | "income">("value");
  const anchor = data.balances.latest?.date;
  const captured = data.balances.latest?.capturedAt;
  useEffect(() => {
    let active = true;
    if (!anchor) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    // Load all saved history once so Max also includes observations older than
    // five years. Window changes and user-entered assumptions remain local.
    void api<Dashboard>(`/api/report?start=0001-01-01&end=9999-12-31`)
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((reason: Error) => {
        if (active) {
          setHistory(null);
          setError(reason.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [anchor, captured, refresh]);
  const calibration = useMemo(
    () => (history ? calibrateProjection(history, settings.lookback) : null),
    [history, settings.lookback],
  );
  const resolved = {} as ProjectionAssumptions;
  const historicalValue = (key: keyof ProjectionAssumptions) =>
    calibration?.defaults[key];
  const invalid: string[] = [];
  for (const field of fields) {
    const override = settings.overrides[field.key];
    const historical = historicalValue(field.key);
    const value =
      override === undefined
        ? historical == null
          ? null
          : Number(historical.toFixed(2))
        : override.trim() === ""
          ? null
          : Number(override);
    const [min, max] = assumptionLimits[field.key];
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      if (
        view === "value" ||
        [
          "cashIncome",
          "stockIncome",
          "incomeGrowth",
          "incomeVolatility",
        ].includes(field.key)
      )
        invalid.push(field.label);
    } else resolved[field.key] = value;
  }
  const latest = history?.balances.latest ?? data.balances.latest;
  const startCents = latest?.netWorthCents;
  const scenario = useMemo(() => {
    if (
      !latest ||
      startCents === null ||
      startCents === undefined ||
      invalid.length
    )
      return null;
    try {
      if (view === "income")
        return projectIncome(
          latest.date,
          settings.years,
          resolved,
          settings.confidence,
        );
      return projectAccountValue(
        startCents,
        latest.date,
        settings.years,
        resolved,
        settings.confidence,
      );
    } catch (reason) {
      return { error: (reason as Error).message };
    }
  }, [
    latest,
    startCents,
    settings.years,
    settings.confidence,
    view,
    ...fields.map((field) => resolved[field.key]),
  ]);
  const update = (patch: Partial<ProjectionSettings>) =>
    onChange({ ...settings, ...patch });
  if (loading)
    return (
      <p className="loading" role="status">
        Loading saved projection history…
      </p>
    );
  if (error)
    return (
      <section className="panel empty error-state">
        <h2>Unable to load projection history</h2>
        <p>{error}</p>
        <button className="button" onClick={() => setRefresh(refresh + 1)}>
          Try again
        </button>
      </section>
    );
  if (!latest || startCents === null || startCents === undefined)
    return (
      <section className="panel empty">
        <h2>Projection needs a known net account value</h2>
        <p>
          Both selected accounts and brokerage borrowing must be available.
          Check Data health for missing balance information.
        </p>
      </section>
    );
  const forecast = scenario && !("error" in scenario) ? scenario : null;
  const chartPoints =
    view === "income" ? forecast?.incomePoints : forecast?.points;
  const end = chartPoints?.at(-1);
  const baselineFlows = projectedMonthlyFlows(resolved, 0);
  const firstYear = projectedMonthlyFlows(resolved, 12);
  const shortHistory =
    Math.min(
      calibration?.flowMonths.length ?? 0,
      calibration?.returnMonths.length ?? 0,
    ) < 12;

  const renderField = (field: ProjectionField) => (
    <AssumptionField
      key={field.key}
      field={field}
      historical={historicalValue(field.key)}
      override={settings.overrides[field.key]}
      invalid={invalid.includes(field.label)}
      onChange={(value) =>
        update({ overrides: { ...settings.overrides, [field.key]: value } })
      }
    />
  );
  return (
    <div className="projections">
      <div className="projection-toolbar">
        <label>
          History window
          <select
            value={settings.lookback}
            onChange={(event) =>
              update({
                lookback:
                  event.target.value === "max"
                    ? "max"
                    : Number(event.target.value),
              })
            }
          >
            <option value={12}>Past 12 months</option>
            <option value={36}>Past 3 years</option>
            <option value={60}>Past 5 years</option>
            <option value="max">Max</option>
          </select>
        </label>
        <label>
          Project ahead
          <select
            value={settings.years}
            onChange={(event) => update({ years: Number(event.target.value) })}
          >
            {[1, 5, 10, 20, 30].map((years) => (
              <option key={years} value={years}>
                {years} {years === 1 ? "year" : "years"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Outcome range
          <select
            value={settings.confidence}
            onChange={(event) =>
              update({ confidence: Number(event.target.value) })
            }
          >
            {[50, 80, 95].map((value) => (
              <option key={value} value={value}>
                {value}% of modeled outcomes
              </option>
            ))}
          </select>
        </label>
        <button
          className="button projection-refresh"
          onClick={() => setRefresh(refresh + 1)}
        >
          <RefreshCw size={15} />
          Refresh view
        </button>
      </div>
      <section
        className="panel projection-forecast"
        aria-labelledby="projection-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="projection-heading">
              {view === "income"
                ? "How your income could grow"
                : "Where your accounts could go"}
            </h2>
            <p>
              {view === "income"
                ? "Cash receipts + incoming stock transfers · monthly run rate"
                : "Checking + brokerage, net of borrowing"}{" "}
              · nominal future dollars, without inflation adjustment.
            </p>
          </div>
        </div>
        <div
          className="projection-view-switch"
          role="group"
          aria-label="Projection graph"
        >
          <button
            className="button"
            aria-pressed={view === "value"}
            onClick={() => setView("value")}
          >
            Account value
          </button>
          <button
            className="button"
            aria-pressed={view === "income"}
            onClick={() => setView("income")}
          >
            Monthly income
          </button>
        </div>
        <dl className="projection-summary">
          <div>
            <dt>
              {view === "income" ? "Starting monthly income" : "Starting value"}{" "}
              · {displayDate(latest.date)}
            </dt>
            <dd>
              {view === "income"
                ? Number.isFinite(baselineFlows.income)
                  ? amount(baselineFlows.income)
                  : "—"
                : money(startCents)}
            </dd>
          </div>
          <div>
            <dt>
              {view === "income" ? "Monthly median" : "Median"} after{" "}
              {settings.years} {settings.years === 1 ? "year" : "years"}
            </dt>
            <dd data-testid="projection-end">
              {end ? amount(end.median) : "—"}
            </dd>
          </div>
          <div>
            <dt>{settings.confidence}% modeled range at horizon</dt>
            <dd className="projection-range">
              {end ? `${compact(end.lower)} – ${compact(end.upper)}` : "—"}
            </dd>
          </div>
        </dl>
        {history?.balances.stale && (
          <p className="balance-warning">
            The starting balance is stale. This forecast begins on its saved
            date, not today.
          </p>
        )}
        {((calibration?.incomeTrend.comparisons ?? 0) < 5 ||
          calibration?.incomeTrend.reason === "zero_total") && (
          <p className="balance-warning">
            Income history provides {calibration?.incomeTrend.comparisons ?? 0}{" "}
            complete year-over-year comparisons.{" "}
            {calibration?.incomeTrend.reason === "zero_total"
              ? "A complete annual block has zero income, so geometric income growth and uncertainty are undefined. Enter explicit assumptions to explore a scenario."
              : calibration?.incomeTrend.volatility === null
                ? "There is not enough usable history to estimate income uncertainty; choose a longer window or enter an assumption."
                : "The estimated income band is based on a small sample and may understate future uncertainty."}
          </p>
        )}
        {forecast ? (
          <>
            <div className="projection-legend">
              <span>
                <i className="projection-line-key" />
                Median projection
              </span>
              <span>
                <i className="projection-band-key" />
                {settings.confidence}% modeled outcome range
              </span>
            </div>
            <ProjectionChart
              key={`${latest.date}:${settings.years}:${view}`}
              metric={view === "income" ? "monthly income" : "account value"}
              points={chartPoints!}
              confidence={settings.confidence}
            />
            {view === "value" && forecast.shortfallProbability > 0 && (
              <p className="balance-warning">
                {(forecast.shortfallProbability * 100).toFixed(1)}% of simulated
                paths fall below zero at least once. Negative values represent a
                funding shortfall; borrowing costs are not modeled.
              </p>
            )}
          </>
        ) : (
          <div className="projection-incomplete" role="status">
            <h3>
              {scenario && "error" in scenario
                ? "Adjust this scenario"
                : "Set assumptions to see the forecast"}
            </h3>
            <p>
              {scenario && "error" in scenario
                ? scenario.error
                : `Enter a supported value for: ${invalid.join(", ")}. Growth needs two complete 12-month blocks; uncertainty needs at least three. Select Max to use all available history, or enter your own assumptions.`}
            </p>
          </div>
        )}
      </section>
      <section
        className="projection-assumptions"
        aria-labelledby="assumptions-heading"
      >
        <div className="panel-heading">
          <div>
            <h2 id="assumptions-heading">Projection assumptions</h2>
            <p>
              Adjust a value to explore a scenario. Your inputs stay in browser
              memory and reset when the page reloads.
            </p>
          </div>
          <button
            className="button"
            onClick={() => update({ overrides: {} })}
            disabled={!Object.keys(settings.overrides).length}
          >
            <RotateCcw size={15} />
            Use history estimates
          </button>
        </div>
        <div className="projection-cash-groups">
          <fieldset className="projection-cash-group">
            <legend>Income · cash + stock</legend>
            <div className="projection-cash-controls">
              {fields.slice(0, 4).map(renderField)}
            </div>
          </fieldset>
          <fieldset className="projection-cash-group">
            <legend>Payments · separate growth</legend>
            <div className="projection-cash-controls">
              {fields.slice(4, 8).map(renderField)}
            </div>
          </fieldset>
        </div>
        <div
          className="projection-cash-result"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>Income after one year of compounding</span>
          <p>
            {Number.isFinite(firstYear.income) ? (
              <>
                <strong>{amount(baselineFlows.income)}</strong> / month now →{" "}
                <strong data-testid="projection-year-income">
                  {amount(firstYear.income)}
                </strong>{" "}
                / month after one year at {resolved.incomeGrowth}% annual growth
                (before uncertainty).
              </>
            ) : (
              "Enter monthly income and an annual growth rate to see the compounded income trajectory."
            )}
          </p>
          <p>
            Net monthly contribution at the start:{" "}
            <strong data-testid="projection-net-cash">
              {Number.isFinite(baselineFlows.net)
                ? amount(baselineFlows.net)
                : "—"}
            </strong>
            , after cash and stock outflows.
          </p>
        </div>
        <div className="projection-fields">
          {fields.slice(8).map(renderField)}
        </div>
      </section>
      <details className="projection-method" open={shortHistory}>
        <summary>History & model details</summary>
        <div>
          <p>
            Based on {calibration?.flowMonths.length ?? 0} usable contribution
            months and {calibration?.returnMonths.length ?? 0} usable return
            months out of the {calibration?.historyMonths ?? 0}{" "}
            {settings.lookback === "max" ? "available months" : "months"} before{" "}
            {latest.date.slice(0, 7)}. The starting balance is always the latest
            saved net value, independent of the history window.
          </p>
          {shortHistory && (
            <p className="balance-warning">
              Less than a year of usable history can strongly distort annual
              growth and uncertainty estimates. Try a longer history window or
              enter your own assumptions.
            </p>
          )}
          <p>
            Only whole calendar months within both products’ loaded transaction
            windows are used. Unresolved external flows exclude that month.
            Loaded history does not prove complete records. Return estimates
            additionally require every daily net balance and use the same
            start-of-day inflow / end-of-day outflow convention as Overview.{" "}
            {calibration?.reconstructed
              ? "Some return observations use reconstructed balances."
              : "No reconstructed balances were used in these return estimates."}
          </p>
          <p>
            Monthly baselines use the most recent{" "}
            {calibration?.baselineMonths.length ?? 0} usable months (up to 12),
            rather than averaging across all years. Annual trend estimates use
            complete, non-overlapping 12-month blocks ending before the latest
            balance’s month. Each year-over-year change compares adjacent
            blocks. Gaps are never bridged and zero-total years withhold the
            affected estimate.
          </p>
          <p>
            Income combines cash receipts and incoming stock transfers. Outgoing
            shares remain expenses. Annual income growth is the geometric mean
            of historical year-over-year income factors. Annual income
            uncertainty is the sample standard deviation of their log factors,
            expressed as a percentage. Payments have independently estimated
            growth and uncertainty. A growth rate needs two complete annual
            blocks; uncertainty needs at least three (two year-over-year
            changes).
          </p>
          <p>
            History provides {calibration?.annualWindows.length ?? 0} complete
            annual blocks, {calibration?.incomeTrend.comparisons ?? 0}{" "}
            year-over-year income changes and{" "}
            {calibration?.paymentTrend.comparisons ?? 0} payment changes. Fewer
            than five changes gives a fragile uncertainty estimate. Select Max
            or enter explicit assumptions when history is insufficient.{" "}
            {calibration?.incomeTrend.reason === "zero_total"
              ? "A zero-income annual block makes geometric income growth undefined; no automatic income rate or band is supplied."
              : ""}
          </p>
          <p>
            The graph simulates 1,000 repeatable paths. Each projection year
            draws a new normal log-growth factor for income and one for
            payments, applying its monthly equivalent for the next 12 months.
            Both cash and stock income grow with the income factor. Monthly
            income is added to account value and payments are subtracted at
            month-end; separate monthly investment returns grow positive account
            value. Negative account values indicate a funding shortfall, without
            an assumed borrowing rate.
          </p>
          <p>
            The median and central {settings.confidence}% modeled range are
            calculated at each month for both account value and monthly income.
            The income band reflects observed variation in annual growth,
            conditional on the chosen parameters; it is not a guaranteed
            confidence interval.{" "}
            <a
              href="https://www.itl.nist.gov/div898/handbook/eda/section3/eda3669.htm"
              target="_blank"
              rel="noreferrer"
            >
              NIST describes the lognormal model used for positive growth
              factors
            </a>
            .
          </p>
          <p>
            Income growth compounds over time: 5% per year means ×1.05 after one
            year and ×1.1025 after two, not a one-time percentage adjustment.
            Rates and uncertainty stay constant as assumptions. The model
            excludes within-year seasonality, correlations between income,
            payments and markets, inflation, future tax changes and uncertainty
            in estimated parameters. Saved transfer valuations are not revalued.
            Nothing is saved to the server or changes your ledger.
          </p>
          <p className="projection-months">
            Contribution months: {calibration?.flowMonths.join(", ") || "None"}.
            <br />
            Baseline months: {calibration?.baselineMonths.join(", ") || "None"}.
            <br />
            Return months: {calibration?.returnMonths.join(", ") || "None"}.
            <br />
            Annual blocks:{" "}
            {calibration?.annualWindows
              .map((window) => `${window.start} — ${window.end}`)
              .join("; ") || "None"}
            .
          </p>
        </div>
      </details>
      {forecast && (
        <details className="projection-method">
          <summary>Annual projection values</summary>
          <div className="projection-table-wrap">
            <table>
              <caption>
                {view === "income"
                  ? "Monthly income in dollars per month."
                  : "Account values in dollars."}{" "}
                Bounds cover the central {settings.confidence}% of modeled
                outcomes at each date.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Lower</th>
                  <th scope="col">Median</th>
                  <th scope="col">Upper</th>
                </tr>
              </thead>
              <tbody>
                {chartPoints!
                  .filter((point) => point.month % 12 === 0)
                  .map((point) => (
                    <tr key={point.month}>
                      <th scope="row">{displayDate(point.date)}</th>
                      <td>{amount(point.lower)}</td>
                      <td>{amount(point.median)}</td>
                      <td>{amount(point.upper)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
