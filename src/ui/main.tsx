import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Leaf,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { periodFor, type Period } from "../accounting/dates";
import type { EventKind, FinancialEvent, Valuation } from "../accounting/types";
import { api, money, displayDate, type Dashboard, type Detail } from "./api";
import { openPlaidLink } from "./link";
import "./style.css";

const kindNames: Record<EventKind, string> = {
  cash_income: "Checking income",
  stock_income: "Incoming stock transfers",
  spending: "Checking spending",
  internal_transfer: "Internal transfer",
  ignored: "Excluded activity",
  unknown: "Needs review",
};
type Filter =
  | EventKind
  | "all"
  | "income"
  | "net_cash"
  | "net_recorded"
  | "pending"
  | "review";
type Tab = "overview" | "activity" | "review" | "health";
function Button({
  children,
  onClick,
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`button ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Metric({
  label,
  amount,
  note,
  onClick,
  tone = "",
}: {
  label: string;
  amount: number;
  note: string;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      className={`metric ${tone}`}
      onClick={onClick}
      aria-label={`View ${label} records`}
    >
      <span className="metric-label">
        {label}
        <ArrowUpRight size={15} />
      </span>
      <strong>{money(amount)}</strong>
      <span className="metric-note">{note}</span>
    </button>
  );
}
function Records({
  records,
  accounts,
  filter,
  setFilter,
  open,
  compact = false,
}: {
  records: FinancialEvent[];
  accounts: Dashboard["accounts"];
  filter: Filter;
  setFilter: (v: Filter) => void;
  open: (e: FinancialEvent) => void;
  compact?: boolean;
}) {
  const items = records
    .filter((e) => {
      if (filter === "review") return e.status === "needs_review";
      if (filter === "pending") return e.status === "pending";
      if (filter === "all") return true;
      if (e.status !== "confirmed") return false;
      if (filter === "income")
        return ["cash_income", "stock_income"].includes(e.kind);
      if (filter === "net_cash")
        return ["cash_income", "spending"].includes(e.kind);
      if (filter === "net_recorded")
        return ["cash_income", "stock_income", "spending"].includes(e.kind);
      return e.kind === filter;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return (
    <section className="panel records" id="records">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">THE LEDGER</p>
          <h2>
            {filter === "review" ? "Needs review" : "Account activity"}{" "}
            <span className="count">{items.length}</span>
          </h2>
        </div>
        <label className="select-label">
          <span className="sr-only">Filter activity</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">All activity</option>
            <option value="cash_income">Checking income</option>
            <option value="stock_income">Stock transfers</option>
            <option value="income">Total recorded income</option>
            <option value="spending">Checking spending</option>
            <option value="net_cash">Net cash flow</option>
            <option value="net_recorded">Net recorded inflow</option>
            <option value="internal_transfer">Internal transfers</option>
            <option value="review">Needs review</option>
            <option value="pending">Pending preview</option>
            <option value="ignored">Excluded investment activity</option>
          </select>
        </label>
      </div>
      {!items.length ? (
        <div className="empty">
          <CheckCheck size={28} />
          <h3>
            {filter === "review"
              ? "Nothing to review in this period"
              : "No matching records"}
          </h3>
          <p>Choose another date range or activity filter.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date / account</th>
                <th>Description</th>
                <th>Decision</th>
                <th className="right">Amount</th>
                <th>
                  <span className="sr-only">Open record</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, compact ? 8 : undefined).map((e) => (
                <tr key={e.id}>
                  <td>
                    <span>{displayDate(e.date)}</span>
                    <small>
                      {accounts.find((a) => a.id === e.accountId)?.label ??
                        "Selected account"}
                    </small>
                  </td>
                  <td>
                    <button className="record-link" onClick={() => open(e)}>
                      {e.description}
                    </button>
                    <small>
                      {e.category} ·{" "}
                      {e.sourceType === "bank"
                        ? "Checking transaction"
                        : "Investment transaction"}
                    </small>
                  </td>
                  <td>
                    <span
                      className={`status ${e.status === "needs_review" ? "review" : e.status === "pending" ? "pending" : e.kind === "internal_transfer" ? "internal" : e.kind === "stock_income" ? "stock" : ""}`}
                    >
                      {e.status === "needs_review"
                        ? "Needs review"
                        : e.status === "pending"
                          ? "Pending"
                          : kindNames[e.kind]}
                    </span>
                  </td>
                  <td
                    className={`amount right ${e.status === "confirmed" && e.kind === "cash_income" ? "positive" : ""}`}
                  >
                    {e.amountCents === null
                      ? "Unvalued"
                      : `${e.kind === "spending" ? "−" : e.kind === "cash_income" || e.kind === "stock_income" ? "+" : ""}${money(e.amountCents)}`}
                    <small>
                      {e.status !== "confirmed"
                        ? "Not in totals"
                        : e.kind === "stock_income"
                          ? "In-kind value"
                          : e.kind === "internal_transfer" ||
                              e.kind === "ignored"
                            ? "Excluded from totals"
                            : "USD"}
                    </small>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Open ${e.description}`}
                      onClick={() => open(e)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {compact && items.length > 8 && (
        <button
          className="text-button table-footer"
          onClick={() => {
            setFilter(filter);
            document.getElementById("activity-tab")?.click();
          }}
        >
          View all {items.length} records <ArrowRight size={15} />
        </button>
      )}
    </section>
  );
}
function Trend({
  data,
  select,
}: {
  data: Dashboard;
  select: (month: string) => void;
}) {
  const months = data.trend ?? data.months,
    max = Math.max(
      1,
      ...months.flatMap((m) => [m.cashIncome + m.stockIncome, m.spending]),
    );
  return (
    <section className="panel trend">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">THE BIGGER PICTURE</p>
          <h2>Income & spending</h2>
        </div>
        <span className="subtle">
          {data.period.end.slice(0, 4)} · through {displayDate(data.period.end)}
        </span>
      </div>
      <div className="legend">
        <span>
          <i className="cash-dot" />
          Checking income
        </span>
        <span>
          <i className="stock-dot" />
          Stock transfers
        </span>
        <span>
          <i className="spend-dot" />
          Checking spending
        </span>
      </div>
      {!months.length ? (
        <div className="empty">
          <p>Monthly trends appear after posted activity is available.</p>
        </div>
      ) : (
        <div
          className="chart"
          role="group"
          aria-label="Monthly income and checking spending. Select a month to view its records."
        >
          <div className="chart-guides">
            <span>{money(max)}</span>
            <span>{money(Math.round(max / 2))}</span>
            <span>$0</span>
          </div>
          <div className="bars">
            {months.map((m) => (
              <button
                className="month-bar"
                key={m.month}
                onClick={() => select(m.month)}
                aria-label={`${m.month}: checking income ${money(m.cashIncome)}, stock transfers ${money(m.stockIncome)}, checking spending ${money(m.spending)}`}
              >
                <span className="bar-pair">
                  <span className="income-bar">
                    <span
                      className="bar-stock"
                      style={{ height: `${(m.stockIncome / max) * 100}%` }}
                    />
                    <span
                      className="bar-cash"
                      style={{ height: `${(m.cashIncome / max) * 100}%` }}
                    />
                  </span>
                  <span
                    className="bar-spend"
                    style={{ height: `${(m.spending / max) * 100}%` }}
                  />
                </span>
                <span className="month-label">
                  {new Date(m.month + "-15T12:00:00Z").toLocaleDateString(
                    "en-US",
                    { month: "short", timeZone: "UTC" },
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="chart-note">
        Stock transfers are valued on arrival. They are part of recorded income,
        not cash income.
      </p>
    </section>
  );
}
function ReviewRecord({
  detail,
  close,
  saved,
}: {
  detail: Detail;
  close: () => void;
  saved: () => void;
}) {
  const { event, source } = detail;
  const [kind, setKind] = useState<EventKind>(
    event.kind === "unknown"
      ? source.kind === "bank"
        ? "internal_transfer"
        : "stock_income"
      : event.kind,
  );
  const [rationale, setRationale] = useState(""),
    [postingDate, setPostingDate] = useState(event.date);
  const [price, setPrice] = useState(event.valuation?.close ?? ""),
    [priceDate, setPriceDate] = useState(
      event.valuation?.priceDate ?? source.date,
    ),
    [provider, setProvider] = useState(event.valuation?.provider ?? "");
  const [preview, setPreview] = useState<{
      before: FinancialEvent;
      after: FinancialEvent;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const payload = () => ({
    eventId: event.id,
    baseRevision: event.revision,
    kind,
    date: postingDate,
    rationale,
    ...(kind === "stock_income" && source.kind === "investment"
      ? {
          valuation: {
            securityId: source.securityId ?? "",
            quantity: source.quantity ?? "",
            eventDate: postingDate,
            close: price,
            priceDate,
            provider,
            currency: "USD",
            retrievedAt: new Date().toISOString(),
            convention: "last_session_close",
          } satisfies Valuation,
        }
      : {}),
  });
  const changed = () => setPreview(null);
  async function submit(save: boolean) {
    setBusy(true);
    setError("");
    try {
      if (save) {
        await api("/api/overrides", payload());
        saved();
      } else setPreview(await api("/api/review/preview", payload()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={event.description} close={close}>
      <div className="dialog-body">
        <div className="record-summary">
          <span
            className={`status ${event.status === "needs_review" ? "review" : ""}`}
          >
            {event.status === "needs_review"
              ? "Needs review"
              : kindNames[event.kind]}
          </span>
          <strong>
            {event.amountCents === null ? "Unvalued" : money(event.amountCents)}
          </strong>
        </div>
        <p className="decision-reason">{event.reason}</p>
        <dl className="detail-grid">
          <div>
            <dt>Posted date</dt>
            <dd>{displayDate(event.date)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {event.sourceType === "bank"
                ? "Checking transaction"
                : "Investment transaction"}
            </dd>
          </div>
          {source.kind === "investment" && (
            <>
              <div>
                <dt>Security / shares</dt>
                <dd>
                  {source.ticker ?? source.securityId ?? "Missing identity"} ·{" "}
                  {source.quantity ?? "Unknown quantity"}
                </dd>
              </div>
              <div>
                <dt>Activity / direction</dt>
                <dd>
                  {source.activity} · {source.direction}
                </dd>
              </div>
            </>
          )}
        </dl>
        {event.valuation && (
          <div className="quote">
            <strong>Historical valuation</strong>
            <p>
              {event.valuation.quantity} shares × ${event.valuation.close} ·{" "}
              {event.valuation.priceDate}
            </p>
            <small>
              {event.valuation.provider}. Original valuation retained.
            </small>
          </div>
        )}
        {event.status === "pending" ? (
          <p className="callout">
            Pending records stay outside confirmed totals. Review after the
            transaction posts.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(false);
            }}
            onChange={changed}
          >
            <h3>Review this decision</h3>
            <div className="form-grid">
              <label>
                Classification
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as EventKind)}
                >
                  {(source.kind === "bank"
                    ? [
                        "cash_income",
                        "spending",
                        "internal_transfer",
                        "ignored",
                        "unknown",
                      ]
                    : source.activity === "transfer"
                      ? ["stock_income", "ignored", "unknown"]
                      : ["ignored", "unknown"]
                  ).map((k) => (
                    <option key={k} value={k}>
                      {kindNames[k as EventKind]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Correct posting date
                <input
                  required
                  type="date"
                  value={postingDate}
                  onChange={(e) => setPostingDate(e.target.value)}
                />
              </label>
            </div>
            {kind === "stock_income" && (
              <>
                <p className="help">
                  Confirm an external security receipt using institution
                  evidence. Use the USD closing price on arrival, or the last
                  prior trading session.
                </p>
                <div className="form-grid">
                  <label>
                    Historical close (USD)
                    <input
                      required
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="184.32"
                    />
                  </label>
                  <label>
                    Price session date
                    <input
                      required
                      type="date"
                      value={priceDate}
                      max={postingDate}
                      onChange={(e) => setPriceDate(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  Historical price source
                  <input
                    required
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="Provider / statement reference"
                  />
                </label>
              </>
            )}
            <label>
              Decision rationale
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="What evidence supports this decision?"
              />
            </label>
            {preview && (
              <div
                className={`preview ${preview.after.status === "needs_review" ? "callout" : ""}`}
              >
                <strong>Effect on this record</strong>
                <p>
                  {kindNames[preview.before.kind]} (
                  {preview.before.status === "confirmed"
                    ? money(preview.before.amountCents ?? 0)
                    : "excluded"}
                  ) <ArrowRight size={14} /> {kindNames[preview.after.kind]} (
                  {preview.after.status === "confirmed"
                    ? money(preview.after.amountCents ?? 0)
                    : "excluded"}
                  )
                </p>
                <small>{preview.after.reason}</small>
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                type="submit"
                disabled={busy || rationale.trim().length < 5}
              >
                Preview change
              </Button>
              <Button
                className="primary"
                onClick={() => void submit(true)}
                disabled={
                  busy ||
                  !preview ||
                  (preview.after.status !== "confirmed" && kind !== "unknown")
                }
              >
                <Check size={16} />
                Save decision
              </Button>
            </div>
          </form>
        )}
        <details>
          <summary>Source & decision history</summary>
          <pre>{JSON.stringify(source, null, 2)}</pre>
          {detail.history.length ? (
            detail.history.map((o) => (
              <div className="audit-entry" key={o.id}>
                <strong>{kindNames[o.kind]}</strong>
                <p>{o.rationale}</p>
                <small>
                  {o.createdAt} · Reviewer: {o.actor}
                </small>
              </div>
            ))
          ) : (
            <p className="help">
              No manual decisions. Classified by {event.ruleVersion}.
            </p>
          )}
        </details>
      </div>
    </Modal>
  );
}
function AddReceipt({
  close,
  saved,
}: {
  close: () => void;
  saved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Record an incoming share transfer" close={close}>
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          if (!values.providerTransactionId)
            delete values.providerTransactionId;
          setBusy(true);
          setError("");
          try {
            await api("/api/receipts", values);
            saved();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="help">
          Use a verified external receipt into the selected brokerage. This
          records household in-kind income at its historical arrival value.
        </p>
        <div className="form-grid">
          <label>
            Unique receipt reference
            <input
              name="reference"
              required
              minLength={3}
              placeholder="receipt-001"
            />
          </label>
          <label>
            Arrival date
            <input name="date" type="date" required />
          </label>
          <label>
            Security identifier
            <input
              name="securityId"
              required
              placeholder="Stable provider security ID"
            />
          </label>
          <label>
            Ticker
            <input name="ticker" required placeholder="EXM" />
          </label>
          <label>
            Exact share quantity
            <input
              name="quantity"
              required
              inputMode="decimal"
              placeholder="42.5"
            />
          </label>
          <label>
            Historical close (USD)
            <input
              name="close"
              required
              inputMode="decimal"
              placeholder="184.32"
            />
          </label>
          <label>
            Price session date
            <input name="priceDate" type="date" required />
          </label>
          <label>
            Historical price source
            <input
              name="priceSource"
              required
              minLength={3}
              placeholder="Historical quote / statement"
            />
          </label>
        </div>
        <label>
          Plaid transaction ID, if known
          <input
            name="providerTransactionId"
            placeholder="Prevents a second event on later sync"
          />
        </label>
        <label>
          Receipt evidence & rationale
          <textarea
            name="rationale"
            required
            minLength={10}
            placeholder="Reference the institution receipt, external origin, quantity, and closing price evidence."
          />
        </label>
        <p className="help">
          If a matching provider transfer already exists, review that record
          instead. Do not enter the same receipt twice.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button onClick={close}>Cancel</Button>
          <Button className="primary" type="submit" disabled={busy}>
            Record verified receipt
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function Health({
  data,
  connect,
  syncing,
  sync,
}: {
  data: Dashboard;
  connect: () => void;
  syncing: boolean;
  sync: () => void;
}) {
  return (
    <section className="panel health" id="health">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">KNOW WHAT IS INCLUDED</p>
          <h2>Data health</h2>
        </div>
        <ShieldCheck size={21} />
      </div>
      <div className="health-top">
        <span
          className={`status ${data.connectionStatus === "connected" ? "" : "review"}`}
        >
          {data.illustrative
            ? "Illustrative · no bank connected"
            : data.connectionStatus.replaceAll("_", " ")}
        </span>
        <Button onClick={sync} disabled={syncing}>
          <RefreshCw size={15} />
          Request sync
        </Button>
      </div>
      <div className="health-grid">
        {data.coverage.map((h) => (
          <article key={h.product}>
            <div className="health-product">
              <span className="health-dot" />
              <h3>
                {h.product === "checking"
                  ? "Checking transactions"
                  : "Brokerage investments"}
              </h3>
            </div>
            <dl>
              <div>
                <dt>Last successful sync</dt>
                <dd>
                  {h.lastSuccess
                    ? new Date(h.lastSuccess).toLocaleString("en-US", {
                        timeZone: "America/Los_Angeles",
                        dateStyle: "medium",
                        timeStyle: "short",
                      }) + " PT"
                    : "Not synced"}
                </dd>
              </div>
              <div>
                <dt>Most recent posted event</dt>
                <dd>
                  {h.mostRecentDate ? displayDate(h.mostRecentDate) : "Unknown"}
                </dd>
              </div>
              <div>
                <dt>Complete through</dt>
                <dd>
                  {h.completeThrough
                    ? displayDate(h.completeThrough)
                    : "Not established"}
                </dd>
              </div>
              <div>
                <dt>Coverage starts</dt>
                <dd>
                  {h.startDate ? displayDate(h.startDate) : "Not established"}
                </dd>
              </div>
            </dl>
            <p className="help">{h.limitation}</p>
            {h.error && (
              <p className="error">Sync needs attention: {h.error}</p>
            )}
          </article>
        ))}
      </div>
      {data.actor.admin && !data.illustrative && (
        <div className="health-footer">
          <Button className="primary" onClick={connect}>
            <LockKeyhole size={15} />
            {data.connectionStatus === "not_connected"
              ? "Connect selected accounts"
              : "Repair Plaid connection"}
          </Button>
          <p className="help">
            Independent Plaid authorization. Only the two privately configured
            accounts are ingested.
          </p>
        </div>
      )}
    </section>
  );
}
function App() {
  const [period, setPeriod] = useState<Period>(() => periodFor("month")),
    [preset, setPreset] = useState("month");
  const [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview"),
    [filter, setFilter] = useState<Filter>("all"),
    [detail, setDetail] = useState<Detail | null>(null),
    [add, setAdd] = useState(false),
    [syncing, setSyncing] = useState(false);
  const request = useRef(0);
  async function load() {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const value = await api<Dashboard>(
        `/api/report?start=${period.start}&end=${period.end}`,
      );
      if (id === request.current) setData(value);
    } catch (e) {
      if (id === request.current) {
        setData(null);
        setError((e as Error).message);
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [period.start, period.end]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("oauth_state_id")) {
      void openPlaidLink(
        () => {
          setNotice(
            "Account authorization completed. Request a sync from Data health.",
          );
          void load();
        },
        setNotice,
        true,
      ).catch((e) => setNotice((e as Error).message));
    }
  }, []);
  function drill(value: Filter) {
    setFilter(value);
    setTab("activity");
  }
  async function open(e: FinancialEvent) {
    try {
      setDetail(await api<Detail>("/api/events/" + encodeURIComponent(e.id)));
    } catch (err) {
      setNotice((err as Error).message);
    }
  }
  async function sync() {
    setSyncing(true);
    try {
      const result = await api<{ illustrative?: boolean }>("/api/sync", {});
      setNotice(
        result.illustrative
          ? "Illustrative mode: no financial provider is connected."
          : "Sync requested. Data health will show when each product finishes.",
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }
  async function connect() {
    try {
      await openPlaidLink(() => {
        setNotice("Connection authorized. Request a sync to start ingestion.");
        void load();
      }, setNotice);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const totals = data?.totals;
  return (
    <>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Beanbag home">
          <span className="brand-mark">
            <Leaf size={22} />
          </span>
          beanbag
          <span className="brand-divider" />
          <small>HOUSEHOLD LEDGER</small>
        </a>
        <span className="private-label">
          <LockKeyhole size={13} />
          Private by design
        </span>
      </header>
      <main>
        <div className="workspace-bar">
          <nav aria-label="Main navigation">
            {(
              [
                ["overview", "Overview"],
                ["activity", "Activity"],
                ["review", "Needs review"],
                ["health", "Data health"],
              ] as const
            ).map(([value, label]) => (
              <button
                id={`${value}-tab`}
                key={value}
                onClick={() => {
                  setTab(value);
                  if (value === "review") setFilter("review");
                  else if (value === "activity") setFilter("all");
                }}
                className={tab === value ? "active" : ""}
                aria-current={tab === value ? "page" : undefined}
              >
                {label}
                {value === "review" && !!data?.review.count && (
                  <span className="nav-count">{data.review.count}</span>
                )}
              </button>
            ))}
          </nav>
          <span className="time-zone">America/Los_Angeles</span>
        </div>
        {data?.illustrative && (
          <div className="illustration-bar">
            <span>
              <span className="demo-dot" />
              Illustrative data
            </span>
            <p>All figures and accounts are invented. No bank is connected.</p>
            <CircleHelp size={15} />
          </div>
        )}
        <div className="page-heading">
          <div>
            <p className="eyebrow">TWO ACCOUNTS. ONE CLEAR PICTURE.</p>
            <h1>
              {tab === "overview"
                ? "Your household, in view."
                : tab === "activity"
                  ? "Follow every dollar."
                  : tab === "review"
                    ? "A little clarity needed."
                    : "A clear view of coverage."}
            </h1>
            <p className="subtitle">
              {tab === "overview"
                ? "What came in, what went out, and what stayed between accounts."
                : tab === "review"
                  ? "Unresolved records stay outside confirmed totals until you review them."
                  : tab === "health"
                    ? "Independent sync status, reporting gaps, and connection details."
                    : "Every total leads back to its posted records and decision evidence."}
            </p>
          </div>
          <Button onClick={() => setAdd(true)} disabled={!data}>
            <Plus size={16} />
            Record stock receipt
          </Button>
        </div>
        <div className="period-bar">
          <div className="period-presets" aria-label="Reporting period">
            {[
              ["month", "This month"],
              ["previous", "Last month"],
              ["quarter", "Quarter"],
              ["year", "Year"],
              ["custom", "Custom"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={preset === value ? "selected" : ""}
                aria-pressed={preset === value}
                onClick={() => {
                  setPreset(value);
                  if (value !== "custom") setPeriod(periodFor(value));
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="custom-period">
              <label>
                <span className="sr-only">Start date</span>
                <input
                  aria-label="Start date"
                  type="date"
                  value={period.start}
                  max={period.end}
                  onChange={(e) => {
                    if (e.target.value)
                      setPeriod({ ...period, start: e.target.value });
                  }}
                />
              </label>
              <span>to</span>
              <label>
                <span className="sr-only">End date</span>
                <input
                  aria-label="End date"
                  type="date"
                  value={period.end}
                  min={period.start}
                  onChange={(e) => {
                    if (e.target.value)
                      setPeriod({ ...period, end: e.target.value });
                  }}
                />
              </label>
            </div>
          ) : (
            <span className="period-label">
              {displayDate(period.start)} — {displayDate(period.end)}
            </span>
          )}
        </div>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {error ? (
          <section className="panel empty error-state">
            <LockKeyhole size={32} />
            <h2>Unable to open the ledger</h2>
            <p>{error}</p>
            <Button onClick={() => void load()}>Try again</Button>
          </section>
        ) : loading ? (
          <div className="loading" role="status">
            <RefreshCw size={22} />
            <p>Opening the ledger…</p>
          </div>
        ) : (
          data &&
          totals && (
            <>
              {data.review.count > 0 && tab !== "review" && (
                <button
                  className="review-banner"
                  onClick={() => {
                    setTab("review");
                    setFilter("review");
                  }}
                >
                  <span className="review-symbol">!</span>
                  <span>
                    <strong>
                      {data.review.count} records need a closer look
                    </strong>
                    <small>
                      {data.review.knownCents
                        ? `${money(data.review.knownCents)} in known amounts`
                        : "Unresolved amounts"}
                      {data.review.unvalued
                        ? ` · ${data.review.unvalued} unvalued`
                        : ""}{" "}
                      · excluded from confirmed totals for this period
                    </small>
                  </span>
                  <span className="review-action">
                    Review <ArrowRight size={16} />
                  </span>
                </button>
              )}
              {tab === "overview" && (
                <>
                  <div className="summary-grid">
                    <section className="income-summary">
                      <div className="summary-top">
                        <span className="eyebrow">
                          <ArrowDownLeft size={15} />
                          CONFIRMED INCOME
                        </span>
                        <span className="status subtle-status">
                          {data.review.count
                            ? "Partial · review open"
                            : "Confirmed records"}
                        </span>
                      </div>
                      <button
                        className="hero-metric"
                        aria-label="View total recorded income records"
                        onClick={() => drill("income")}
                      >
                        <span>
                          Total recorded income <ArrowUpRight size={18} />
                        </span>
                        <strong>{money(totals.totalIncome)}</strong>
                      </button>
                      <div className="income-parts">
                        <button onClick={() => drill("cash_income")}>
                          <i className="cash-dot" />
                          <span>
                            Checking income<small>Cash received</small>
                          </span>
                          <strong>{money(totals.cashIncome)}</strong>
                        </button>
                        <button onClick={() => drill("stock_income")}>
                          <i className="stock-dot" />
                          <span>
                            Incoming stock transfers
                            <small>Valued in-kind · not cash</small>
                          </span>
                          <strong>{money(totals.stockIncome)}</strong>
                        </button>
                      </div>
                    </section>
                    <section className="spending-summary">
                      <div className="summary-top">
                        <span className="eyebrow">
                          <ArrowUpRight size={15} />
                          CONFIRMED OUTFLOW
                        </span>
                      </div>
                      <button
                        className="hero-metric"
                        aria-label="View checking spending records"
                        onClick={() => drill("spending")}
                      >
                        <span>
                          Checking spending <ArrowUpRight size={18} />
                        </span>
                        <strong>{money(totals.spending)}</strong>
                      </button>
                      <p>
                        Includes credit-card payments when paid.
                        <br />
                        Individual card purchases are not counted.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => drill("spending")}
                      >
                        Explore payments <ArrowRight size={15} />
                      </button>
                    </section>
                  </div>
                  <div className="flow-strip">
                    <Metric
                      label="Net cash flow"
                      amount={totals.netCashFlow}
                      note="Checking income − checking spending"
                      onClick={() => drill("net_cash")}
                    />
                    <Metric
                      label="Net recorded inflow"
                      amount={totals.netRecordedFlow}
                      note="Cash + in-kind − checking spending"
                      onClick={() => drill("net_recorded")}
                      tone="recorded"
                    />
                    <button
                      className="boundary-metric"
                      aria-label="View excluded internal transfers records"
                      onClick={() => drill("internal_transfer")}
                    >
                      <span className="metric-label">
                        Excluded internal transfers
                        <ArrowUpRight size={15} />
                      </span>
                      <strong>{money(totals.internalTransfers)}</strong>
                      <span className="boundary-route">
                        Checking <ArrowLeftRight size={14} /> Brokerage
                      </span>
                      <span className="metric-note">
                        Movement inside your two-account boundary
                      </span>
                    </button>
                  </div>
                  <div className="middle-grid">
                    <Trend
                      data={data}
                      select={(month) => {
                        setPreset("custom");
                        setPeriod({
                          start: month + "-01",
                          end: new Date(
                            Date.UTC(
                              Number(month.slice(0, 4)),
                              Number(month.slice(5, 7)),
                              0,
                            ),
                          )
                            .toISOString()
                            .slice(0, 10),
                        });
                        setFilter("all");
                        setTab("activity");
                      }}
                    />
                    <section className="panel breakdown">
                      <div className="panel-heading">
                        <div>
                          <p className="eyebrow">WHERE IT WENT</p>
                          <h2>Checking spending</h2>
                        </div>
                      </div>
                      {data.breakdown.filter((b) => b.kind === "spending")
                        .length ? (
                        data.breakdown
                          .filter((b) => b.kind === "spending")
                          .sort((a, b) => b.amountCents - a.amountCents)
                          .map((b) => (
                            <button
                              className="breakdown-row"
                              key={b.category}
                              onClick={() => drill("spending")}
                            >
                              <span>{b.category}</span>
                              <strong>{money(b.amountCents)}</strong>
                              <span className="breakdown-track">
                                <span
                                  style={{
                                    width: `${totals.spending ? (b.amountCents / totals.spending) * 100 : 0}%`,
                                  }}
                                />
                              </span>
                            </button>
                          ))
                      ) : (
                        <p className="help">
                          No confirmed spending in this period.
                        </p>
                      )}
                      <p className="help">
                        Payments leaving checking, including transfers to
                        accounts outside this pair.
                      </p>
                    </section>
                  </div>
                  <Records
                    records={data.records}
                    accounts={data.accounts}
                    filter={filter}
                    setFilter={setFilter}
                    open={(e) => void open(e)}
                    compact
                  />
                </>
              )}
              {(tab === "activity" || tab === "review") && (
                <>
                  {tab === "review" && (
                    <div className="review-intro">
                      <Clock3 size={22} />
                      <p>
                        <strong>{data.review.count} unresolved records</strong>
                        <br />
                        {data.review.knownCents
                          ? money(data.review.knownCents) + " known"
                          : "No known cash amount"}{" "}
                        · {data.review.unvalued} awaiting valuation. A
                        successful sync does not establish complete coverage.
                      </p>
                    </div>
                  )}
                  <Records
                    records={data.records}
                    accounts={data.accounts}
                    filter={tab === "review" ? "review" : filter}
                    setFilter={(value) => {
                      setFilter(value);
                      if (value !== "review") setTab("activity");
                    }}
                    open={(e) => void open(e)}
                  />
                </>
              )}
              {(tab === "health" || tab === "overview") && (
                <Health
                  data={data}
                  connect={() => void connect()}
                  syncing={syncing}
                  sync={() => void sync()}
                />
              )}
            </>
          )
        )}
        <footer>
          <span>
            <Leaf size={14} />
            beanbag
          </span>
          <p>
            A boundary-based household ledger. Recorded stock income is not tax
            income.
          </p>
          <span>
            <ShieldCheck size={13} />
            {data?.illustrative ? "Illustrative preview" : "Private access"}
          </span>
        </footer>
      </main>
      {detail && (
        <ReviewRecord
          detail={detail}
          close={() => setDetail(null)}
          saved={() => {
            setDetail(null);
            setNotice("Decision saved with reviewer and evidence.");
            void load();
          }}
        />
      )}
      {add && (
        <AddReceipt
          close={() => setAdd(false)}
          saved={() => {
            setAdd(false);
            setNotice(
              "Verified receipt recorded once at its historical arrival value.",
            );
            void load();
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
