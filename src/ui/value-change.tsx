import type { ValueChange } from "../accounting/value-change";
import { displayDate, money } from "./api";

const signed = (value: number | null) =>
  value === null ? "Unavailable" : `${value > 0 ? "+" : ""}${money(value)}`;
const percent = (value: number | null | undefined) =>
  value == null
    ? "Unavailable"
    : `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value)}`;

export function ValueChangeBreakdown({ data }: { data: ValueChange | null }) {
  if (!data) return null;
  const ready = data.status === "estimated";
  const twr = data.timeWeightedReturn;
  return (
    <div
      className="value-change"
      role="group"
      aria-label="Account value change breakdown"
    >
      <div className="value-change-heading">
        <h3>Change breakdown</h3>
        {data.flowPeriod && (
          <p>
            {displayDate(data.flowPeriod.start)} —{" "}
            {displayDate(data.flowPeriod.end)}
          </p>
        )}
      </div>
      {data.changeCents === null ? (
        <p className="help">
          Two dated net account values are needed to compare this period.
        </p>
      ) : (
        <>
          <dl className="value-change-amounts">
            <div>
              <dt>Total change</dt>
              <dd>{signed(data.changeCents)}</dd>
            </div>
            <div>
              <dt>Income less expenses</dt>
              <dd>
                {signed(data.netFlowCents)}
                {ready && (
                  <p className="help">
                    {money(data.incomeCents!)} income −{" "}
                    {money(data.expensesCents!)} expenses
                  </p>
                )}
              </dd>
            </div>
            <div>
              <dt>Investment gain/loss</dt>
              <dd className="value-change-performance">
                <span>{signed(data.investmentCents)}</span>
                <span
                  className="value-change-return"
                  role="group"
                  aria-label="Time-weighted return"
                >
                  <span>TWR</span> <strong>{percent(twr?.rate)}</strong>
                </span>
                {twr?.annualizedRate != null && (
                  <span
                    className="value-change-return"
                    role="group"
                    aria-label="Annualized time-weighted return"
                  >
                    <span>Annualized</span>{" "}
                    <strong>{percent(twr.annualizedRate)}</strong>
                  </span>
                )}
                <span className="value-change-estimate">Estimates</span>
              </dd>
            </div>
          </dl>
          {ready && twr?.status === "unavailable" && (
            <p className="help">
              {twr.reason === "missing_daily_values"
                ? "Time-weighted return needs a net value for every day in the comparison. The dollar gain/loss can still be estimated from the endpoints."
                : twr.reason === "no_invested_capital"
                  ? "No invested capital is recorded in this comparison, so a percentage return is undefined."
                  : twr.reason === "non_positive_capital"
                    ? "Time-weighted return is unavailable where net capital is negative or the return denominator is zero."
                    : "The saved values do not support a reliable percentage return for this comparison."}
            </p>
          )}
          {data.partialPeriod && (
            <p className="help">
              Using the dates with saved net values. The comparison covers part
              of the selected period.
            </p>
          )}
          {!ready && (
            <p className="help">
              {data.reason === "missing_history"
                ? "Transaction history for both accounts is needed across these dates to separate external flows from investment changes."
                : "Some external flows have incomplete classification or valuation, so investment gain/loss cannot be estimated for these dates."}
            </p>
          )}
          <details className="value-change-details">
            <summary>How this is calculated</summary>
            <p className="help">
              {money(data.opening!.valueCents)} on{" "}
              {displayDate(data.opening!.date)} to{" "}
              {money(data.closing!.valueCents)} on{" "}
              {displayDate(data.closing!.date)}. Flows start the day after the
              opening value and end on the closing date.
            </p>
            <p className="help">
              Income includes external cash and shares; expenses include
              external cash and shares leaving the pair. Transfers between these
              two accounts are excluded.
            </p>
            <p className="help">
              Estimated investment gain/loss is total change minus income plus
              expenses. It includes dividends, interest, fees and valuation or
              timing differences. It is a dollar estimate, not a rate of return
              or taxable gain. Loaded history can still omit activity.
            </p>
            <p className="help">
              Time-weighted return compounds daily returns after adjusting for
              external cash and share flows. Incoming flows are assumed to
              arrive at the start of each day and outgoing flows at the end. TWR
              is the cumulative return over the compared dates; intraday
              valuations are unavailable. When those dates span more than one
              calendar year, annualized TWR is also shown using compound growth
              on a 365-day basis: (1 + TWR) raised to (365 / elapsed days),
              minus one. A shorter available comparison is never annualized just
              because the selected range is longer. Brokerage dividends,
              interest and fees remain in performance.
            </p>
            {(data.estimatedBalances || twr?.usesReconstructedValues) && (
              <p className="help">
                This comparison uses a reconstructed balance with the same-day
                settlement assumption.
              </p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
