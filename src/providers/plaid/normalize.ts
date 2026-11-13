import { cents } from "../../accounting/money";
import { validDate } from "../../accounting/dates";
import { parse } from "lossless-json";
import type {
  BankSource,
  InvestmentSource,
  Source,
} from "../../accounting/types";
import { decimalText, rawJson, type JsonRecord } from "./client";

export async function revisionOf(value: unknown): Promise<string> {
  // Key order is stable because normalized records are assembled explicitly below.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function withRevision<T extends Omit<Source, "revision">>(
  record: T,
): Promise<T & { revision: string }> {
  return { ...record, revision: await revisionOf(record) };
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid provider field");
  return value;
}
function date(value: unknown): string {
  const v = string(value);
  if (!validDate(v)) throw new Error("Invalid provider date");
  return v;
}

function bankCategory(raw: JsonRecord): string | undefined {
  const primary = raw.personal_finance_category?.primary;
  if (typeof primary !== "string") return undefined;
  // Plaid groups credit-card payments under LOAN_PAYMENTS. Keep the supported
  // detail in the reporting label instead of implying every payment is a loan.
  if (primary === "LOAN_PAYMENTS") {
    const labels: Record<string, string> = {
      LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: "Credit-card payments",
      LOAN_PAYMENTS_OTHER_PAYMENT: "Other payments",
      LOAN_PAYMENTS_CAR_PAYMENT: "Auto loan payments",
      LOAN_PAYMENTS_MORTGAGE_PAYMENT: "Mortgage payments",
      LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT: "Personal loan payments",
      LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: "Student loan payments",
    };
    const detail = raw.personal_finance_category?.detailed;
    return typeof detail === "string" && Object.hasOwn(labels, detail)
      ? labels[detail]
      : "Loan payments (provider category)";
  }
  return primary.replaceAll("_", " ").toLowerCase();
}

export async function normalizeBank(
  raw: JsonRecord,
): Promise<{ record: BankSource; raw: string }> {
  const record = await withRevision({
    kind: "bank" as const,
    id: string(raw.transaction_id),
    accountId: string(raw.account_id),
    date: date(raw.date),
    description: string(raw.name),
    currency: raw.iso_currency_code ?? "UNKNOWN",
    amountCents: -cents(decimalText(raw.amount)),
    pending: raw.pending === true,
    pendingId:
      typeof raw.pending_transaction_id === "string"
        ? raw.pending_transaction_id
        : undefined,
    category: bankCategory(raw),
  });
  return { record, raw: rawJson(raw) };
}

/** Recover category detail on reads; never rewrite saved provider evidence. */
export function bankPaymentCategory(source: Source, raw: string): Source {
  if (source.kind !== "bank" || source.category !== "loan payments")
    return source;
  try {
    const evidence = parse(raw) as JsonRecord;
    if (
      evidence?.transaction_id !== source.id ||
      evidence.account_id !== source.accountId ||
      evidence.date !== source.date ||
      evidence.personal_finance_category?.primary !== "LOAN_PAYMENTS" ||
      -cents(decimalText(evidence.amount)) !== source.amountCents
    )
      return source;
    return { ...source, category: bankCategory(evidence) };
  } catch {
    return source;
  }
}

export async function normalizeInvestment(
  raw: JsonRecord,
  securities: JsonRecord[],
): Promise<{ record: InvestmentSource; raw: string }> {
  const security = securities.find((s) => s.security_id === raw.security_id);
  const activity = string(raw.type),
    subtype = typeof raw.subtype === "string" ? raw.subtype : undefined;
  const record = await withRevision({
    kind: "investment" as const,
    id: string(raw.investment_transaction_id),
    accountId: string(raw.account_id),
    date: date(raw.date),
    description: string(raw.name),
    currency: raw.iso_currency_code ?? "UNKNOWN",
    activity: raw.cancel_transaction_id ? "cancel" : activity,
    subtype,
    securityId:
      typeof raw.security_id === "string" ? raw.security_id : undefined,
    ticker:
      typeof security?.ticker_symbol === "string"
        ? security.ticker_symbol
        : undefined,
    securityType:
      typeof security?.type === "string" ? security.type : undefined,
    quantity: raw.quantity == null ? undefined : decimalText(raw.quantity),
    unitPrice: raw.price == null ? undefined : decimalText(raw.price),
    cashAmountCents: -cents(decimalText(raw.amount)),
    direction: "unknown" as const,
    origin: "unknown" as const,
    cancelledId:
      typeof raw.cancel_transaction_id === "string"
        ? raw.cancel_transaction_id
        : undefined,
  });
  return {
    record,
    raw: rawJson({ transaction: raw, security: security ?? null }),
  };
}

/** Enrich older stored normalizations from their unchanged original provider evidence. */
export function transferPricing(source: Source, raw: string): Source {
  if (source.kind !== "investment" || source.activity !== "transfer")
    return source;
  let evidence: JsonRecord;
  try {
    evidence = parse(raw) as JsonRecord;
  } catch {
    return source;
  }
  const transaction = evidence?.transaction;
  if (
    transaction?.investment_transaction_id !== source.id ||
    transaction.type !== "transfer" ||
    transaction.account_id !== source.accountId ||
    transaction.date !== source.date ||
    transaction.security_id !== source.securityId
  )
    return source;
  let unitPrice = source.unitPrice;
  if (unitPrice === undefined && transaction.price != null) {
    try {
      unitPrice = decimalText(transaction.price);
    } catch {
      /* Keep malformed legacy pricing unvalued. */
    }
  }
  return {
    ...source,
    securityType:
      source.securityType ??
      (typeof evidence.security?.type === "string"
        ? evidence.security.type
        : undefined),
    unitPrice,
  };
}
