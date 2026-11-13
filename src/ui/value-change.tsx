import type { ValueChange } from "../accounting/value-change";
import { displayDate, money } from "./api";

const signed = (value: number | null) =>
  value === null ? "Unavailable" : `${value > 0 ? "+" : ""}${money(value)}`;

export function ValueChangeBreakdown({ data }: { data: ValueChange | null }) {
  if (!data) return null;
  const ready = data.status === "estimated";
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
              <dd>
                {signed(data.investmentCents)}
                <span className="value-change-estimate">Estimate</span>
              </dd>
            </div>
          </dl>
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
            {data.estimatedBalances && (
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
