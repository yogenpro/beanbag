import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowRight,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Leaf,
  LayoutDashboard,
  LockKeyhole,
  RefreshCw,
  Rows3,
  ShieldCheck,
  X,
} from "lucide-react";
import { PeriodPicker } from "./period-picker";
import { periodOptions, type RangeSelection } from "./periods";
import type { Period } from "../accounting/dates";
import { transactionCoverage } from "../accounting/coverage";
import type { EventKind, FinancialEvent } from "../accounting/types";
import { api, money, displayDate, type Dashboard, type Detail } from "./api";
import { AccountValue } from "./account-value";
import { movementDirection } from "../accounting/movements";
import "./style.css";

const kindNames: Record<EventKind, string> = {
  cash_income: "Cash income",
  stock_income: "Incoming stock transfers",
  spending: "Cash payments",
  stock_spending: "Outgoing stock transfers",
  internal_transfer: "Internal transfer",
  ignored: "Excluded activity",
  unknown: "Unclassified",
};
const statusName = (event: FinancialEvent) =>
  event.status === "pending"
    ? "Pending"
    : event.status === "needs_review"
      ? event.kind !== "unknown" && event.amountCents === null
        ? "Unvalued"
        : "Unclassified"
      : kindNames[event.kind];
type Filter =
  | EventKind
  | "all"
  | "income"
  | "expenses"
  | "net_cash"
  | "net_recorded"
  | "pending"
  | "unclassified";
type Tab = "overview" | "activity" | "health";
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
  category,
  setFilter,
  open,
  compact = false,
  viewAll,
}: {
  records: FinancialEvent[];
  accounts: Dashboard["accounts"];
  filter: Filter;
  category?: string | null;
  setFilter: (v: Filter) => void;
  open: (e: FinancialEvent) => void;
  compact?: boolean;
  viewAll?: () => void;
}) {
  const items = records
    .filter((e) => {
      if (category && e.category !== category) return false;
      if (filter === "unclassified") return e.status === "needs_review";
      if (filter === "pending") return e.status === "pending";
      if (filter === "all") return true;
      if (e.status !== "confirmed") return false;
      if (filter === "income")
        return ["cash_income", "stock_income"].includes(e.kind);
      if (filter === "expenses")
        return ["spending", "stock_spending"].includes(e.kind);
      if (filter === "net_cash")
        return ["cash_income", "spending"].includes(e.kind);
      if (filter === "net_recorded")
        return [
          "cash_income",
          "stock_income",
          "spending",
          "stock_spending",
        ].includes(e.kind);
      return e.kind === filter;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return (
    <section className="panel records" id="records">
      <div className="panel-heading">
        <div>
          <h2>
            {filter === "unclassified"
              ? "Incomplete entries"
              : compact
                ? "Recent activity"
                : "Records"}{" "}
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
            <option value="cash_income">Cash income</option>
            <option value="stock_income">Stock transfers</option>
            <option value="income">Total recorded income</option>
            <option value="expenses">Total expenses</option>
            <option value="spending">Cash payments</option>
            <option value="stock_spending">Outgoing stock transfers</option>
            <option value="net_cash">Net cash flow</option>
            <option value="net_recorded">Net recorded inflow</option>
            <option value="internal_transfer">Internal transfers</option>
            <option value="unclassified">Incomplete entries</option>
            <option value="pending">Pending</option>
            <option value="ignored">Excluded investment activity</option>
          </select>
        </label>
      </div>
      {category && (
        <p className="help activity-category">
          <span>Category: {category}</span>
          <button className="text-button" onClick={() => setFilter(filter)}>
            Clear category filter
          </button>
        </p>
      )}
      {!items.length ? (
        <div className="empty">
          <CheckCheck size={28} />
          <h3>
            {filter === "unclassified"
              ? "No incomplete entries in this period"
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
                <th>Status</th>
                <th className="right">Amount</th>
                <th>
                  <span className="sr-only">Open record</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, compact ? 5 : undefined).map((e) => (
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
                      className={`status ${e.status === "needs_review" ? "review" : e.status === "pending" ? "pending" : e.kind === "internal_transfer" || e.kind === "ignored" ? "internal" : e.kind === "stock_income" ? "stock" : ["spending", "stock_spending"].includes(e.kind) ? "outflow" : ""}`}
                    >
                      {statusName(e)}
                    </span>
                  </td>
                  <td
                    className={`amount right ${e.status === "confirmed" && e.kind === "cash_income" ? "positive" : ""}`}
                  >
                    {e.amountCents === null
                      ? "Unvalued"
                      : `${["spending", "stock_spending"].includes(e.kind) ? "−" : e.kind === "cash_income" || e.kind === "stock_income" ? "+" : ""}${money(e.amountCents)}`}
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
      {compact && items.length > 5 && (
        <button className="text-button table-footer" onClick={viewAll}>
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
          <h2>Income & expenses</h2>
        </div>
        <span className="subtle">
          {displayDate(data.period.start)} — {displayDate(data.period.end)}
        </span>
      </div>
      <div className="legend">
        <span>
          <i className="cash-dot" />
          Cash income
        </span>
        <span>
          <i className="stock-dot" />
          Stock transfers
        </span>
        <span>
          <i className="spend-dot" />
          Expenses
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
          aria-label="Monthly income and expenses. Select a month to view its records."
        >
          <div className="chart-guides" aria-hidden="true">
            <span>{money(max)}</span>
            <span>{money(Math.round(max / 2))}</span>
            <span>$0</span>
          </div>
          <div
            className="bars-viewport"
            tabIndex={0}
            role="group"
            aria-label="Scroll monthly income and expenses"
          >
            <div className="bars">
              {months.map((m) => (
                <button
                  className={`month-bar ${data.period.start.startsWith(m.month) && data.period.end.startsWith(m.month) ? "selected" : ""}`}
                  key={m.month}
                  onClick={() => select(m.month)}
                  aria-label={`${m.month}: cash income ${money(m.cashIncome)}, stock transfers ${money(m.stockIncome)}, expenses ${money(m.spending)}`}
                  title={`${m.month}: checking ${money(m.cashIncome)} · stock ${money(m.stockIncome)} · spending ${money(m.spending)}`}
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
                      {
                        month: "short",
                        year:
                          data.period.start.slice(0, 4) !==
                          data.period.end.slice(0, 4)
                            ? "2-digit"
                            : undefined,
                        timeZone: "UTC",
                      },
                    )}
                  </span>
                </button>
              ))}
            </div>
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
function RecordDetail({
  detail,
  close,
}: {
  detail: Detail;
  close: () => void;
}) {
  const { event, source } = detail;
  return (
    <Modal title={event.description} close={close}>
      <div className="dialog-body">
        <div className="record-summary">
          <span
            className={`status ${event.status === "needs_review" ? "review" : ""}`}
          >
            {statusName(event)}
          </span>
          <strong>
            {event.amountCents === null ? "Unvalued" : money(event.amountCents)}
          </strong>
        </div>
        <p className="decision-reason">{event.reason}</p>
        {event.status === "needs_review" && (
          <p className="callout">
            This entry is excluded from income and spending because its
            classification or valuation is incomplete.
          </p>
        )}
        {event.status === "pending" && (
          <p className="callout">
            Pending transactions are excluded from confirmed totals.
          </p>
        )}
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
                  {source.activity} · {movementDirection(source)}
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
              {displayDate(event.valuation.priceDate)}
            </p>
            <small>
              {event.valuation.convention === "provider_transfer_price"
                ? "Recorded transfer price"
                : "Saved historical close"}{" "}
              · {event.valuation.provider}. Original valuation retained.
            </small>
          </div>
        )}
        <details>
          <summary>Source & classification history</summary>
          <pre>{JSON.stringify(source, null, 2)}</pre>
          {detail.history.length ? (
            detail.history.map((o) => (
              <div className="audit-entry" key={o.id}>
                <strong>{kindNames[o.kind]}</strong>
                <p>{o.rationale}</p>
                <small>{o.createdAt}</small>
              </div>
            ))
          ) : (
            <p className="help">
              Classified from the source record. No recorded adjustments.
            </p>
          )}
        </details>
      </div>
    </Modal>
  );
}
function Health({
  data,
  refresh,
  loading,
}: {
  data: Dashboard;
  refresh: () => void;
  loading: boolean;
}) {
  return (
    <section className="panel health" id="health">
      <div className="panel-heading">
        <div>
          <h2>Connection & coverage</h2>
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
        <Button onClick={refresh} disabled={loading}>
          <RefreshCw size={15} />
          Refresh view
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
            {h.history && (
              <p className="help">
                Loaded transactions: {displayDate(h.history.start)} —{" "}
                {displayDate(h.history.end)}.
              </p>
            )}
            <p className="help">{h.limitation}</p>
            {h.error && (
              <p className="error">Sync needs attention: {h.error}</p>
            )}
          </article>
        ))}
      </div>
      <div className="balance-sync-health">
        <h3>Account balances</h3>
        <p className="help">
          Last collected:{" "}
          {data.balances.health.lastSuccess
            ? new Date(data.balances.health.lastSuccess).toLocaleString(
                "en-US",
                {
                  timeZone: "America/Los_Angeles",
                  dateStyle: "medium",
                  timeStyle: "short",
                },
              ) + " PT"
            : "Not collected"}
          . Institution values may be cached. Saved snapshots appear in
          Overview.
        </p>
        {data.balances.health.error && (
          <p className="error">
            Balance refresh needs attention: {data.balances.health.error}
          </p>
        )}
      </div>
    </section>
  );
}
function App() {
  const [selection, setSelection] = useState<RangeSelection>({
    tab: "month",
    value: "rolling",
  });
  const [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  const [availablePeriod, setAvailablePeriod] = useState<Period>();
  const [tab, setTab] = useState<Tab>("overview"),
    [filter, setFilter] = useState<Filter>("all"),
    [category, setCategory] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const request = useRef(0);
  const options = periodOptions(selection.tab, availablePeriod);
  const selected =
    options.find((option) => option.value === selection.value) ?? options[0];
  const period = selected.period;
  async function load() {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const value = await api<Dashboard>(
        `/api/report?start=${period.start}&end=${period.end}`,
      );
      if (id === request.current) {
        setData(value);
        setAvailablePeriod(value.availablePeriod);
      }
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
  function changeFilter(value: Filter) {
    setFilter(value);
    setCategory(null);
  }
  function drill(value: Filter, category: string | null = null) {
    setFilter(value);
    setCategory(category);
    setTab("activity");
  }
  async function open(e: FinancialEvent) {
    try {
      setDetail(await api<Detail>("/api/events/" + encodeURIComponent(e.id)));
    } catch (err) {
      setNotice((err as Error).message);
    }
  }
  const totals = data?.totals;
  const history = transactionCoverage(data?.coverage ?? [], period);
  const showFlows = history.status === "available" || !!data?.records.length;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <a className="brand" href="/" aria-label="Beanbag home">
          <span className="brand-mark">
            <Leaf size={24} />
          </span>
          beanbag
        </a>
        <p className="workspace-label">Household ledger</p>
        <nav aria-label="Main navigation">
          {(
            [
              ["overview", "Overview", LayoutDashboard],
              ["activity", "Activity", Rows3],
              ["health", "Data health", Activity],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              id={`${value}-tab`}
              key={value}
              onClick={() => {
                setTab(value);
                if (value === "activity") changeFilter("all");
              }}
              className={tab === value ? "active" : ""}
              aria-current={tab === value ? "page" : undefined}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-boundary">
          <h2>Your reporting boundary</h2>
          <div>
            <span className="account-node" />
            Checking
          </div>
          <span className="account-connector" aria-hidden="true" />
          <div>
            <span className="account-node brokerage" />
            Brokerage
          </div>
          <p>
            One household. Internal cash movements stay outside your totals.
          </p>
        </div>
        <div className="sidebar-footer">
          <span>
            <LockKeyhole size={14} />
            Private by design
          </span>
          <span>Pacific time</span>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1}>
        {data?.illustrative && (
          <div className="illustration-bar">
            <span>
              <span className="demo-dot" />
              Illustrative data
            </span>
            <p>All figures and accounts are invented. No bank is connected.</p>
          </div>
        )}
        <div className="page-heading">
          <div>
            <h1>
              {tab === "overview"
                ? "Overview"
                : tab === "activity"
                  ? "Account activity"
                  : "Data health"}
            </h1>
            <p className="subtitle">
              {tab === "overview"
                ? "Account value, income, and spending across your two accounts."
                : tab === "health"
                  ? "Independent sync status, reporting gaps, and connection details."
                  : "Browse posted records and the evidence behind each total."}
            </p>
          </div>
          <span className="read-only-label">
            <LockKeyhole size={14} aria-hidden="true" />
            Read-only
          </span>
        </div>
        <PeriodPicker
          selection={selection}
          options={options}
          selected={selected}
          onChange={setSelection}
        />
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
            <span className="sr-only">Opening the ledger…</span>
            <div className="skeleton-summary" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="skeleton-chart" aria-hidden="true" />
          </div>
        ) : (
          data &&
          totals && (
            <>
              {tab === "overview" && (
                <>
                  <AccountValue
                    key={`${period.start}:${period.end}`}
                    data={data.balances}
                    accounts={data.accounts}
                  />
                  <div className="section-heading">
                    <h2>Confirmed totals</h2>
                    <span
                      className={`status ${data.review.count || history.status !== "available" ? "review" : ""}`}
                    >
                      {!showFlows
                        ? "History unavailable"
                        : history.status === "partial"
                          ? "Partial period"
                          : history.status === "unknown"
                            ? "Saved records"
                            : data.review.count
                              ? "Incomplete entries excluded"
                              : "Confirmed records"}
                    </span>
                  </div>
                  <p
                    className={`transaction-history ${history.status === "partial" || history.status === "unknown" ? "balance-warning" : "help"}`}
                  >
                    {history.start &&
                    history.end &&
                    history.start <= history.end ? (
                      <>
                        {history.status === "available"
                          ? "Transaction history loaded for both accounts: "
                          : "Loaded transaction history for both accounts: "}
                        {displayDate(history.start)} —{" "}
                        {displayDate(history.end)}.
                        {history.status === "partial" &&
                          " This range extends beyond that history; totals use only available records."}
                      </>
                    ) : (
                      "Transaction-history coverage is not recorded for both accounts. Totals use saved records only."
                    )}
                  </p>
                  {!showFlows ? (
                    <div className="balance-empty">
                      <h3>
                        {history.status === "unavailable"
                          ? "No transaction history for this period"
                          : "Full-period totals unavailable"}
                      </h3>
                      <p>
                        Choose a period with loaded transactions to view income
                        and expenses.
                      </p>
                    </div>
                  ) : (
                    <>
                      {data.review.count > 0 && (
                        <div className="excluded-note">
                          <CircleAlert size={16} aria-hidden="true" />
                          <p>
                            {data.review.count}{" "}
                            {data.review.count === 1
                              ? "entry is"
                              : "entries are"}{" "}
                            excluded from income and spending because
                            classification or valuation is incomplete.
                          </p>
                          <button
                            className="text-button"
                            onClick={() => drill("unclassified")}
                          >
                            View entries <ArrowRight size={15} />
                          </button>
                        </div>
                      )}
                      <div className="summary-grid">
                        <section className="income-summary">
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
                                Cash income
                                <small>Received by either account</small>
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
                          <button
                            className="hero-metric"
                            aria-label="View total expense records"
                            onClick={() => drill("expenses")}
                          >
                            <span>
                              Total expenses <ArrowUpRight size={18} />
                            </span>
                            <strong>{money(totals.spending)}</strong>
                          </button>
                          <p>
                            Cash and shares leaving either account.
                            <br />
                            Credit-card payments count when paid.
                          </p>
                          {totals.stockSpending > 0 && (
                            <p className="help">
                              Cash payments {money(totals.cashSpending)} · Share
                              transfers {money(totals.stockSpending)}
                            </p>
                          )}
                          <button
                            className="text-button"
                            onClick={() => drill("expenses")}
                          >
                            Explore expenses <ArrowRight size={15} />
                          </button>
                        </section>
                      </div>
                      <div className="flow-strip">
                        <Metric
                          label="Net cash flow"
                          amount={totals.netCashFlow}
                          note="Cash income − cash payments"
                          onClick={() => drill("net_cash")}
                        />
                        <Metric
                          label="Net recorded inflow"
                          amount={totals.netRecordedFlow}
                          note="Total income − total expenses"
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
                            setSelection({ tab: "month", value: month });
                            changeFilter("all");
                            setTab("activity");
                          }}
                        />
                        <section className="panel breakdown">
                          <div className="panel-heading">
                            <div>
                              <h2>Expense breakdown</h2>
                            </div>
                          </div>
                          {data.breakdown.filter((b) =>
                            ["spending", "stock_spending"].includes(b.kind),
                          ).length ? (
                            data.breakdown
                              .filter((b) =>
                                ["spending", "stock_spending"].includes(b.kind),
                              )
                              .sort((a, b) => b.amountCents - a.amountCents)
                              .map((b) => (
                                <button
                                  className="breakdown-row"
                                  key={`${b.kind}:${b.category}`}
                                  onClick={() =>
                                    drill(b.kind as EventKind, b.category)
                                  }
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
                            Cash and share transfers leaving the tracked pair.
                          </p>
                        </section>
                      </div>
                      <Records
                        records={data.records}
                        accounts={data.accounts}
                        filter={filter}
                        category={category}
                        setFilter={changeFilter}
                        open={(e) => void open(e)}
                        compact
                        viewAll={() => drill(filter)}
                      />
                    </>
                  )}
                  <button
                    className="coverage-link"
                    onClick={() => setTab("health")}
                  >
                    <ShieldCheck size={18} />
                    <span>
                      <strong>Know what is included</strong>
                      <small>
                        View sync status and reporting gaps in Data health.
                      </small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                </>
              )}
              {tab === "activity" && (
                <Records
                  records={data.records}
                  accounts={data.accounts}
                  filter={filter}
                  category={category}
                  setFilter={changeFilter}
                  open={(e) => void open(e)}
                />
              )}
              {tab === "health" && (
                <Health
                  data={data}
                  refresh={() => void load()}
                  loading={loading}
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
      {detail && <RecordDetail detail={detail} close={() => setDetail(null)} />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
