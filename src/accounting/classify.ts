import { daysApart, validDate } from "./dates";
import { decimalIdentity, positiveDecimal, valueShares } from "./money";
import {
  absoluteQuantity,
  cashMovement,
  investmentTransfer,
  movementDirection,
  oppositeMovement,
  transferCandidate,
} from "./movements";
import {
  eventId,
  type Account,
  type FinancialEvent,
  type InvestmentSource,
  type Override,
  type Source,
  type Valuation,
} from "./types";

export const RULE_VERSION = "boundary-2";

export function validateValuation(
  source: InvestmentSource,
  valuation: Valuation,
): number {
  if (
    valuation.securityId !== source.securityId ||
    decimalIdentity(valuation.quantity) !==
      decimalIdentity(absoluteQuantity(source.quantity) ?? "") ||
    valuation.eventDate !== source.date ||
    valuation.currency !== "USD" ||
    !["last_session_close", "provider_transfer_price"].includes(
      valuation.convention,
    ) ||
    !valuation.provider.trim() ||
    !validDate(valuation.priceDate) ||
    valuation.priceDate > source.date ||
    daysApart(valuation.priceDate, source.date) > 7 ||
    (valuation.convention === "last_session_close" &&
      !Number.isFinite(Date.parse(valuation.retrievedAt ?? ""))) ||
    (valuation.convention === "provider_transfer_price" &&
      (valuation.priceDate !== source.date ||
        decimalIdentity(valuation.close) !==
          decimalIdentity(source.unitPrice ?? "")))
  ) {
    throw new Error("Historical valuation does not match arrival evidence");
  }
  return valueShares(valuation.quantity, valuation.close);
}

export function classify(
  source: Source,
  accounts: Account[],
  override?: Override,
  valuation?: Valuation,
  matched: boolean | string = false,
): FinancialEvent {
  const base: FinancialEvent = {
    id: eventId(source),
    sourceId: source.id,
    sourceType: source.kind,
    accountId: source.accountId,
    date: source.date,
    description: source.description,
    kind: "unknown",
    status: "needs_review",
    amountCents: cashMovement(source)
      ? Math.abs(
          source.kind === "bank" ? source.amountCents : source.cashAmountCents,
        )
      : null,
    category: "Unclassified",
    reason: "Evidence required",
    revision: source.revision,
    ruleVersion: RULE_VERSION,
  };
  const decision = (changes: Partial<FinancialEvent>): FinancialEvent => ({
    ...base,
    ...changes,
  });
  const ignore = (reason: string) =>
    decision({
      kind: "ignored",
      status: "confirmed",
      amountCents: 0,
      category: "Investment activity",
      reason,
    });
  const account = accounts.find((a) => a.id === source.accountId);
  if (!account)
    return ignore("Account is outside the configured two-account boundary");
  if (source.removed)
    return decision({
      kind: "ignored",
      status: "removed",
      amountCents: 0,
      reason: "Removed or cancelled by provider",
    });
  if (!validDate(source.date))
    return decision({ reason: "Invalid posting date" });
  if (source.kind === "bank" && source.pending)
    return decision({
      status: "pending",
      reason: "Pending preview; excluded from confirmed totals",
    });
  if (source.currency !== "USD")
    return decision({ reason: "USD conversion requires review" });
  if (source.kind === "bank" && !Number.isSafeInteger(source.amountCents))
    return decision({ amountCents: null, reason: "Invalid money precision" });
  if (override) {
    if (override.baseRevision !== source.revision)
      return decision({
        overrideId: override.id,
        reason: "Source changed since override; review the saved decision",
      });
    const date = override.date ?? source.date;
    if (!validDate(date))
      return decision({ reason: "Override date is invalid" });
    if (override.kind === "unknown")
      return decision({
        date,
        overrideId: override.id,
        reason: override.rationale,
      });
    if (
      override.kind === "stock_income" ||
      override.kind === "stock_spending"
    ) {
      if (
        source.kind !== "investment" ||
        source.activity !== "transfer" ||
        cashMovement(source) ||
        !override.valuation
      )
        return decision({
          reason:
            "Stock receipt requires security-transfer and valuation evidence",
        });
      try {
        const amount = validateValuation(
          { ...source, date },
          override.valuation,
        );
        return decision({
          date,
          kind: override.kind,
          status: "confirmed",
          amountCents: amount,
          valuation: override.valuation,
          category:
            override.kind === "stock_income"
              ? "Incoming stock transfers"
              : "Outgoing stock transfers",
          reason: override.rationale,
          overrideId: override.id,
        });
      } catch {
        return decision({
          reason:
            "Override valuation is incomplete or does not match arrival evidence",
          overrideId: override.id,
        });
      }
    }
    if (
      (override.kind === "cash_income" || override.kind === "spending") &&
      (!cashMovement(source) ||
        (source.kind === "investment" && !investmentTransfer(source)))
    )
      return decision({
        reason: "Cash metrics require an external cash movement",
      });
    return decision({
      date,
      kind: override.kind,
      status: "confirmed",
      amountCents: override.kind === "ignored" ? 0 : base.amountCents,
      category: "Reviewed",
      reason: override.rationale,
      overrideId: override.id,
    });
  }
  const counterpart = accounts.find(
    (a) => a.id === source.counterpartAccountId && a.id !== account.id,
  );
  const internal = (reason: string) =>
    decision({
      kind: "internal_transfer",
      status: "confirmed",
      category: "Internal transfer",
      amountCents: base.amountCents ?? 0,
      transferGroup: typeof matched === "string" ? matched : base.id,
      reason,
    });
  if (
    source.kind === "bank" ||
    investmentTransfer(source) ||
    (source.kind === "investment" && source.activity === "cash" && matched)
  ) {
    if (
      counterpart ||
      matched ||
      (source.kind === "investment" && source.origin === "internal")
    )
      return internal(
        counterpart
          ? "Counterparty is the other tracked account"
          : "Matched movement between the two tracked accounts",
      );
    const other = accounts.find((a) => a.id !== account.id);
    const statedMask = source.description.match(
      /(?:checking|brokerage).*?(?:[-…*]|ending(?:\s+in)?\s+)(\d{4})\b/i,
    )?.[1];
    const knownRole =
      account.role === "joint_checking" ? "brokerage" : "checking";
    if (
      other &&
      statedMask === other.mask &&
      new RegExp(knownRole, "i").test(source.description)
    )
      return internal("Transfer identifies the other tracked account");
    if (cashMovement(source)) {
      const amount =
        source.kind === "bank" ? source.amountCents : source.cashAmountCents;
      if (!Number.isSafeInteger(amount))
        return decision({
          amountCents: null,
          reason: "Invalid money precision",
        });
      if (amount === 0) return ignore("Zero-value cash event");
      const incoming = amount > 0;
      return decision({
        kind: incoming ? "cash_income" : "spending",
        status: "confirmed",
        category: incoming
          ? /payroll|salary|direct deposit/i.test(source.description)
            ? "Payroll"
            : "External cash receipts"
          : /card|amex|visa|mastercard|discover/i.test(source.description)
            ? "Credit-card payments"
            : source.kind === "bank"
              ? (source.category ?? "External cash payments")
              : "External cash transfers",
        reason: incoming
          ? "Cash entered a tracked account from outside the pair"
          : "Cash left a tracked account for outside the pair",
      });
    }
  }
  if (source.kind !== "investment")
    return decision({ reason: "Unrecognized cash movement" });
  if (!investmentTransfer(source)) {
    if (
      [
        "buy",
        "sell",
        "dividend",
        "interest",
        "fee",
        "cash",
        "split",
        "reinvestment",
        "corporate_action",
        "cancel",
      ].includes(source.activity)
    )
      return ignore(
        "Trading, brokerage cash income or corporate action stays inside the boundary",
      );
    return decision({
      reason:
        "Unrecognized investment activity; verify it is not a corporate action",
    });
  }
  const direction = movementDirection(source);
  const quantity = absoluteQuantity(source.quantity);
  if (
    !source.securityId ||
    !quantity ||
    !positiveDecimal(quantity) ||
    direction === "unknown"
  )
    return decision({
      reason:
        "Share transfer is missing its direction, security identity or exact quantity",
    });
  const kind = direction === "in" ? "stock_income" : "stock_spending";
  if (!valuation && source.unitPrice && positiveDecimal(source.unitPrice))
    valuation = {
      securityId: source.securityId,
      quantity,
      eventDate: source.date,
      close: source.unitPrice,
      priceDate: source.date,
      currency: "USD",
      provider: "Institution transfer record via Plaid",
      convention: "provider_transfer_price",
    };
  if (!valuation)
    return decision({
      kind,
      category:
        direction === "in"
          ? "Incoming stock transfers"
          : "Outgoing stock transfers",
      reason:
        "Transfer is classified; its recorded price is missing. Current quotes are not substituted.",
    });
  try {
    return decision({
      kind,
      status: "confirmed",
      amountCents: validateValuation(source, valuation),
      valuation,
      category:
        direction === "in"
          ? "Incoming stock transfers"
          : "Outgoing stock transfers",
      reason:
        valuation.convention === "provider_transfer_price"
          ? "External share transfer valued at its recorded transfer price"
          : "External share transfer valued at its saved historical close",
    });
  } catch {
    return decision({
      reason: "Saved valuation does not match the current transfer record",
    });
  }
}

/** Match unique reciprocal transfer legs; both accounts must identify transfer activity. */
export function transferMatches(
  sources: Source[],
  accounts: Account[],
): Map<string, string> {
  const ids = new Set(accounts.map((a) => a.id));
  const transfers = sources.filter(
    (s) => ids.has(s.accountId) && transferCandidate(s),
  );
  const mask = (source: Source) =>
    source.description.match(
      /(?:checking|brokerage).*?(?:[-…*]|ending(?:\s+in)?\s+)(\d{4})\b/i,
    )?.[1];
  const candidates = new Map<string, string[]>();
  for (const source of transfers) {
    const matches = transfers.filter(
      (other) =>
        other.accountId !== source.accountId &&
        source.currency === other.currency &&
        validDate(source.date) &&
        validDate(other.date) &&
        daysApart(source.date, other.date) <= 3 &&
        (!source.counterpartAccountId ||
          source.counterpartAccountId === other.accountId) &&
        (!other.counterpartAccountId ||
          other.counterpartAccountId === source.accountId) &&
        (!mask(source) ||
          mask(source) ===
            accounts.find((a) => a.id === other.accountId)?.mask) &&
        (!mask(other) ||
          mask(other) ===
            accounts.find((a) => a.id === source.accountId)?.mask) &&
        (!source.transferReference ||
          !other.transferReference ||
          source.transferReference === other.transferReference) &&
        oppositeMovement(source, other),
    );
    candidates.set(eventId(source), matches.map(eventId));
  }
  const result = new Map<string, string>();
  for (const [id, matches] of candidates) {
    if (matches.length !== 1) continue;
    const other = matches[0];
    if (
      candidates.get(other)?.length !== 1 ||
      candidates.get(other)?.[0] !== id
    )
      continue;
    const group = [id, other].sort().join("|");
    result.set(id, group);
    result.set(other, group);
  }
  return result;
}
