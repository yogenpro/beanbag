import { useId, useState } from "react";
import type { BalancePoint, BalanceReport } from "../accounting/balances";
import type { Account } from "../accounting/types";
import { displayDate, money } from "./api";
import { ValueChangeBreakdown } from "./value-change";

const timestamp = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " PT";
const amount = (value: number | null) =>
  value === null ? "Unavailable" : money(value);

export function AccountValue({
  data,
  accounts,
  interactive = true,
}: {
  data: BalanceReport;
  accounts: Account[];
  interactive?: boolean;
}) {
  const { latest, history } = data;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const labelId = useId();
  const net =
    !latest || latest.netWorthCents !== null || latest.marginLoanCents !== null;
  const value = (point: BalancePoint) =>
    net ? point.netWorthCents : point.assetsCents;
  const accountValue = (point: BalancePoint, id: string) => {
    const b = point.accounts.find((a) => a.accountId === id);
    if (!b) return null;
    if (!net) return b.currentCents;
    if (b.netValueCents !== undefined) return b.netValueCents;
    return b.currentCents !== null && b.marginLoanCents !== null
      ? b.currentCents - b.marginLoanCents
      : null;
  };
  const source = (point: BalancePoint) =>
    point.historyMethods
      ? point.historyMethods
          .map((m) =>
            m === "institution_export"
              ? "Institution export"
              : m === "reconstructed"
                ? "Reconstructed estimate"
                : "Plaid Assets",
          )
          .join(" + ")
      : "Balance snapshot";
  const index = Math.min(
    selectedIndex ?? history.length - 1,
    history.length - 1,
  );
  const selected = history[index];
  const first = history[0],
    last = history.at(-1);
  const change =
    data.change?.changeCents ??
    (first &&
    last &&
    value(first) !== null &&
    value(last) !== null &&
    history.length > 1
      ? value(last)! - value(first)!
      : null);
  const available = history.filter((p) => value(p) !== null);
  const low = Math.min(...available.map((p) => value(p)!));
  const high = Math.max(...available.map((p) => value(p)!));
  const spread = Math.max(high - low, Math.abs(high) * 0.02, 100);
  const floor = low - spread * 0.15,
    ceiling = high + spread * 0.15;
  const x = (point: BalancePoint) =>
    history.length === 1
      ? 50
      : 4 +
        (92 * (Date.parse(point.date) - Date.parse(first.date))) /
          Math.max(86_400_000, Date.parse(last!.date) - Date.parse(first.date));
  const y = (point: BalancePoint) =>
    92 - (84 * (value(point)! - floor)) / (ceiling - floor);
  let path = "";
  history.forEach((point, i) => {
    if (value(point) === null) return;
    const previous = history[i - 1];
    const connected =
      previous &&
      value(previous) !== null &&
      Date.parse(point.date) - Date.parse(previous.date) <= 86_400_000;
    path += `${connected ? "L" : "M"}${x(point)},${y(point)} `;
  });
  return (
    <section className="account-value" aria-labelledby={labelId}>
      <div className="section-heading">
        <h2 id={labelId}>
          {net ? "Tracked net worth" : "Tracked account value"}
        </h2>
        <span className="account-scope">Checking + brokerage</span>
      </div>
      {!latest ? (
        <div className="balance-empty">
          <h3>No balance snapshots yet</h3>
          <p>
            History starts when the first account balances are collected. Data
            health shows the latest collection status.
          </p>
        </div>
      ) : (
        <div className="balance-summary">
          <div>
            <strong className="balance-total">{amount(value(latest))}</strong>
            <p className="balance-collected">
              {latest.asOfDate
                ? `As of ${displayDate(latest.date)}`
                : `Latest snapshot · ${timestamp(latest.capturedAt)}`}
            </p>
            <p className="help">
              Latest recorded value, regardless of the reporting period.
            </p>
          </div>
          <dl className="balance-breakdown">
            {accounts.map((account) => {
              const balance = latest.accounts.find(
                (b) => b.accountId === account.id,
              );
              return (
                <div key={account.id}>
                  <dt>
                    <i
                      className={
                        account.role === "joint_checking"
                          ? "cash-dot"
                          : "stock-dot"
                      }
                    />
                    {account.role === "joint_checking"
                      ? "Checking"
                      : balance?.netValueCents !== undefined
                        ? "Brokerage · net value"
                        : "Brokerage · cash & holdings"}
                  </dt>
                  <dd>
                    {amount(
                      balance?.netValueCents ?? balance?.currentCents ?? null,
                    )}
                  </dd>
                </div>
              );
            })}
            {!latest.historyMethods && latest.marginLoanCents !== 0 && (
              <div>
                <dt>Brokerage borrowing</dt>
                <dd>
                  {amount(
                    latest.marginLoanCents === null
                      ? null
                      : -latest.marginLoanCents,
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {!net && (
        <p className="balance-warning">
          Brokerage borrowing is unavailable. Showing account value before
          borrowing.
        </p>
      )}
      {data.stale && (
        <p className="balance-warning">
          These balances are over 36 hours old. Data health shows the latest
          collection status.
        </p>
      )}
      {data.health.error && (
        <p className="balance-warning" role="status">
          The last balance refresh failed ({data.health.error}). Previous
          snapshots are preserved. Data health shows the collection status.
        </p>
      )}
      {latest && (
        <>
          <div className="balance-history-heading">
            <h3>Balance history</h3>
            <p>
              {change !== null ? (
                <>
                  <strong>
                    {change > 0 ? "+" : ""}
                    {money(change)}
                  </strong>{" "}
                  {data.change?.changeCents !== null && data.change
                    ? "change over compared dates"
                    : `across ${history.length} saved days`}
                </>
              ) : (
                "Selected reporting period"
              )}
            </p>
          </div>
          {history.length === 0 ? (
            <div className="balance-empty">
              <p>
                No snapshots in this period. Choose a period with saved
                balances.
              </p>
            </div>
          ) : available.length === 0 ? (
            <div className="balance-empty">
              <p>
                Both USD account balances{net ? " and brokerage borrowing" : ""}{" "}
                are needed to plot a total. Missing values are not treated as
                zero.
              </p>
            </div>
          ) : (
            <>
              <div className="balance-plot">
                <div className="balance-scale" aria-hidden="true">
                  <span>{money(Math.round(ceiling))}</span>
                  <span>{money(Math.round(floor))}</span>
                </div>
                <svg
                  className="balance-chart"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${net ? "Tracked net worth" : "Account value"} history: ${available.length} daily values. Use ${interactive ? "the date selector or " : ""}the table for exact values.`}
                  onClick={(event) => {
                    if (!interactive) return;
                    const box = event.currentTarget.getBoundingClientRect();
                    const position =
                      ((event.clientX - box.left) / box.width) * 100;
                    const closest = history.reduce(
                      (best, point, i) =>
                        Math.abs(x(point) - position) <
                        Math.abs(x(history[best]) - position)
                          ? i
                          : best,
                      0,
                    );
                    setSelectedIndex(closest);
                  }}
                >
                  {[8, 50, 92].map((level) => (
                    <line
                      key={level}
                      x1="0"
                      x2="100"
                      y1={level}
                      y2={level}
                      className="balance-gridline"
                    />
                  ))}
                  <path d={path} className="balance-line" />
                  {available.map((point, i) => {
                    const adjacent = [available[i - 1], available[i + 1]].some(
                      (other) =>
                        other &&
                        Math.abs(
                          Date.parse(other.date) - Date.parse(point.date),
                        ) === 86_400_000,
                    );
                    // A round, non-scaling stroke stays circular in this responsive SVG.
                    return (
                      <line
                        key={point.date}
                        x1={x(point)}
                        x2={x(point)}
                        y1={y(point)}
                        y2={y(point)}
                        className={`balance-dot${adjacent ? "" : " isolated"}`}
                      />
                    );
                  })}
                  {selected && value(selected) !== null && (
                    <line
                      x1={x(selected)}
                      x2={x(selected)}
                      y1="0"
                      y2="100"
                      className="balance-cursor"
                    />
                  )}
                  {selected && value(selected) !== null && (
                    <line
                      x1={x(selected)}
                      x2={x(selected)}
                      y1={y(selected)}
                      y2={y(selected)}
                      className="balance-dot isolated"
                    />
                  )}
                </svg>
              </div>
              <div className="balance-dates">
                <span>{displayDate(first.date)}</span>
                {history.length > 1 && <span>{displayDate(last!.date)}</span>}
              </div>
              <div className="balance-selection" aria-live="polite">
                <span>
                  {selected
                    ? `${displayDate(selected.date)}${selected.historyMethods?.includes("reconstructed") ? " · Estimated" : selected.historyMethods ? " · Imported" : ""}`
                    : "Choose a date"}
                </span>
                <strong>{selected ? amount(value(selected)) : ""}</strong>
              </div>
              {history.length > 1 && interactive ? (
                <label className="balance-slider-label">
                  Inspect a date
                  <input
                    type="range"
                    min="0"
                    max={history.length - 1}
                    step="1"
                    value={index}
                    aria-label="History date"
                    aria-valuetext={
                      selected
                        ? `${displayDate(selected.date)}, ${amount(value(selected))}`
                        : ""
                    }
                    onChange={(e) => setSelectedIndex(Number(e.target.value))}
                  />
                </label>
              ) : history.length === 1 ? (
                <p className="help">
                  One saved value in this period. Choose a longer range to see
                  the trend.
                </p>
              ) : null}
            </>
          )}
          <ValueChangeBreakdown data={data.change ?? null} />
          <p className="balance-method">
            {net ? "Net worth" : "Account value"} for these two accounts only.
            {net ? " Brokerage values include borrowing." : ""} Changes include
            market movements and money entering or leaving; they are not
            investment returns. Gaps have no recorded balance.
            {history.some((p) => p.historyMethods?.includes("reconstructed")) &&
              " Reconstructed daily estimates assume same-day settlement. Reported balances take precedence."}
          </p>
          <details className="balance-details">
            <summary>History & freshness</summary>
            <p className="help">
              Collected from {latest.provider}. Collection time is when Beanbag
              received the data ({timestamp(latest.capturedAt)}); institution
              balances may be older. Stock-receipt income keeps its original
              historical value.
            </p>
            {history.some((p) => p.historyMethods) && (
              <p className="help">
                Imported dates follow the institution’s calendar. Exported net
                account values already include cash and debit balances. Plaid
                Assets supplies calculated checking history where an export is
                unavailable.
              </p>
            )}
            {history.some((p) =>
              p.historyMethods?.includes("reconstructed"),
            ) && (
              <p className="help">
                Reconstructed brokerage values use complete account activity,
                historical closing prices and fund transaction NAVs. Non-trading
                days use the previous close. Same-day settlement can differ from
                statements with unsettled trades. These estimates do not change
                stock-transfer income or the latest reported balance.
              </p>
            )}
            <dl className="balance-source-times">
              {accounts.map((account) => {
                const balance = latest.accounts.find(
                  (b) => b.accountId === account.id,
                );
                return (
                  <div key={account.id}>
                    <dt>
                      {account.role === "joint_checking"
                        ? "Checking"
                        : "Brokerage"}{" "}
                      updated by institution
                    </dt>
                    <dd>
                      {balance?.institutionUpdatedAt
                        ? timestamp(balance.institutionUpdatedAt)
                        : "Not supplied"}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {history.length > 0 && (
              <div className="balance-table-wrap">
                <table>
                  <caption>
                    Daily account values in the reporting period
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Checking</th>
                      <th scope="col">{net ? "Brokerage net" : "Brokerage"}</th>
                      <th scope="col">{net ? "Net worth" : "Account value"}</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().map((point) => (
                      <tr key={point.date}>
                        <th scope="row">{displayDate(point.date)}</th>
                        <td>
                          {amount(
                            accountValue(
                              point,
                              accounts.find((a) => a.role === "joint_checking")
                                ?.id ?? "",
                            ),
                          )}
                        </td>
                        <td>
                          {amount(
                            accountValue(
                              point,
                              accounts.find((a) => a.role === "joint_brokerage")
                                ?.id ?? "",
                            ),
                          )}
                        </td>
                        <td>{amount(value(point))}</td>
                        <td>{source(point)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}
