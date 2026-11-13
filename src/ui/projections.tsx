import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { api, displayDate, money, type Dashboard } from "./api";
import {
  assumptionLimits,
  calibrateProjection,
  projectAccountValue,
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
  lookback: 12,
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
const fields: {
  key: keyof ProjectionAssumptions;
  label: string;
  unit: string;
  help: string;
}[] = [
  {
    key: "cash",
    label: "Monthly net cash flow",
    unit: "$ / month",
    help: "External cash income minus cash payments.",
  },
  {
    key: "shares",
    label: "Monthly net share transfers",
    unit: "$ / month",
    help: "Incoming minus outgoing shares at recorded transfer values.",
  },
  {
    key: "growth",
    label: "Annual investment growth",
    unit: "% / year",
    help: "Geometric growth of the combined accounts, after external flows.",
  },
  {
    key: "volatility",
    label: "Annual return volatility",
    unit: "% / year",
    help: "Standard deviation of log returns; controls market uncertainty.",
  },
  {
    key: "flowDeviation",
    label: "Monthly contribution variability",
    unit: "$ / month",
    help: "Standard deviation of combined cash and share contributions.",
  },
];

function ProjectionChart({
  points,
  confidence,
}: {
  points: ProjectionPoint[];
  confidence: number;
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
          {amount(selected.median)} <span>median</span>
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
          aria-label={`Projected account value with a ${confidence}% modeled outcome range`}
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
          <title>Future tracked account value</title>
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
  const invalid: string[] = [];
  for (const field of fields) {
    const override = settings.overrides[field.key];
    const historical = calibration?.defaults[field.key];
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
    )
      invalid.push(field.label);
    else resolved[field.key] = value;
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
  const end = forecast?.points.at(-1);
  const shortHistory =
    Math.min(
      calibration?.flowMonths.length ?? 0,
      calibration?.returnMonths.length ?? 0,
    ) < 12;
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
            <h2 id="projection-heading">Where your accounts could go</h2>
            <p>
              Checking + brokerage, net of borrowing · nominal future dollars,
              without inflation adjustment.
            </p>
          </div>
        </div>
        <dl className="projection-summary">
          <div>
            <dt>Starting value · {displayDate(latest.date)}</dt>
            <dd>{money(startCents)}</dd>
          </div>
          <div>
            <dt>
              Median after {settings.years}{" "}
              {settings.years === 1 ? "year" : "years"}
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
              key={`${latest.date}:${settings.years}`}
              points={forecast.points}
              confidence={settings.confidence}
            />
            {forecast.shortfallProbability > 0 && (
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
                : `Enter a supported value for: ${invalid.join(", ")}. History needs at least three usable full months for each estimate.`}
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
        <div className="projection-fields">
          {fields.map((field) => {
            const historical = calibration?.defaults[field.key];
            const override = settings.overrides[field.key];
            const outsideLimits =
              historical !== null &&
              historical !== undefined &&
              (historical < assumptionLimits[field.key][0] ||
                historical > assumptionLimits[field.key][1]);
            return (
              <div className="projection-field" key={field.key}>
                <label htmlFor={`projection-${field.key}`}>
                  {field.label}
                  <span>{field.unit}</span>
                </label>
                <input
                  id={`projection-${field.key}`}
                  type="number"
                  step="any"
                  min={assumptionLimits[field.key][0]}
                  max={assumptionLimits[field.key][1]}
                  value={
                    override ??
                    (historical === null || historical === undefined
                      ? ""
                      : Number(historical.toFixed(2)).toString())
                  }
                  placeholder="Enter assumption"
                  aria-invalid={invalid.includes(field.label)}
                  aria-describedby={`projection-${field.key}-help`}
                  onChange={(event) =>
                    update({
                      overrides: {
                        ...settings.overrides,
                        [field.key]: event.target.value,
                      },
                    })
                  }
                />
                <p id={`projection-${field.key}-help`}>{field.help}</p>
                <span className="projection-source">
                  {override !== undefined
                    ? "Your assumption"
                    : outsideLimits
                      ? "History estimate outside supported limits; enter an assumption"
                      : historical === null || historical === undefined
                        ? "Insufficient usable history"
                        : "Estimated from history"}
                </span>
                <span className="projection-limit">
                  Supported: {assumptionLimits[field.key][0].toLocaleString()}{" "}
                  to {assumptionLimits[field.key][1].toLocaleString()}
                </span>
              </div>
            );
          })}
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
            Cash and in-kind transfers are averaged separately, including
            zero-flow months with known coverage. Internal transfers, trades,
            dividends, interest and fees are excluded from contributions; their
            effects remain in investment returns. Annual growth is the geometric
            mean of monthly time-weighted returns, compounded over 12 months.
            Return volatility is the sample standard deviation of monthly log
            returns × √12. Contribution variability is the sample standard
            deviation of monthly net cash plus shares.
          </p>
          <p>
            The graph simulates 1,000 repeatable paths with independent monthly
            normal log returns and normal net contributions at month-end. Growth
            applies to positive account values; negative values indicate a
            funding shortfall. The median and central {settings.confidence}%
            range are calculated separately for each month. This range describes
            outcomes under the selected assumptions, rather than a confidence
            interval for an estimated mean. See{" "}
            <a
              href="https://www.itl.nist.gov/div898/handbook/pmd/section5/pmd512.htm"
              target="_blank"
              rel="noreferrer"
            >
              NIST’s explanation of prediction uncertainty
            </a>
            .
          </p>
          <p>
            Assumptions remain constant. The model does not capture seasonality,
            correlated returns and income, future tax changes, inflation,
            changing allocation, or uncertainty in the estimated parameters.
            Historical growth may not persist. Nothing is saved to the server or
            changes your ledger.
          </p>
          <p className="projection-months">
            Contribution months: {calibration?.flowMonths.join(", ") || "None"}.
            <br />
            Return months: {calibration?.returnMonths.join(", ") || "None"}.
          </p>
        </div>
      </details>
      {forecast && (
        <details className="projection-method">
          <summary>Annual projection values</summary>
          <div className="projection-table-wrap">
            <table>
              <caption>
                Estimated values in dollars. Bounds cover the central{" "}
                {settings.confidence}% of modeled outcomes at each date.
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
                {forecast.points
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
