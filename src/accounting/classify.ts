import { daysApart, validDate } from "./dates";
import { positiveDecimal, valueShares } from "./money";
import {
  eventId,
  type Account,
  type FinancialEvent,
  type InvestmentSource,
  type Override,
  type Source,
  type Valuation,
} from "./types";

export const RULE_VERSION = "boundary-1";

export function validateValuation(
  source: InvestmentSource,
  valuation: Valuation,
): number {
  if (
    valuation.securityId !== source.securityId ||
    valuation.quantity !== source.quantity ||
    valuation.eventDate !== source.date ||
    valuation.currency !== "USD" ||
    valuation.convention !== "last_session_close" ||
    !valuation.provider.trim() ||
    !validDate(valuation.priceDate) ||
    valuation.priceDate > source.date ||
    daysApart(valuation.priceDate, source.date) > 7 ||
    !Number.isFinite(Date.parse(valuation.retrievedAt))
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
  matched = false,
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
    amountCents: source.kind === "bank" ? Math.abs(source.amountCents) : null,
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
    if (override.kind === "stock_income") {
      if (
        source.kind !== "investment" ||
        source.activity !== "transfer" ||
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
          kind: "stock_income",
          status: "confirmed",
          amountCents: amount,
          valuation: override.valuation,
          category: "Stock transfers",
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
      (source.kind !== "bank" || account.role !== "joint_checking")
    )
      return decision({
        reason: "Cash metrics require a checking transaction",
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
  if (source.kind === "bank") {
    if (account.role !== "joint_checking")
      return ignore(
        "Only the selected checking account contributes cash metrics",
      );
    if (counterpart || matched)
      return decision({
        kind: "internal_transfer",
        status: "confirmed",
        category: "Internal transfer",
        reason: counterpart
          ? "Explicit counterparty is the selected brokerage account"
          : "Unique matching transfer with shared source evidence",
      });
    const brokerage = accounts.find((a) => a.role === "joint_brokerage");
    const statedMask = source.description.match(
      /(?:brokerage).*?[-…*](\d{4})\b/i,
    )?.[1];
    const highConfidence =
      /^(?:transfer (?:to|from) brokerage|overdraft transfer from brokerage)(?:\s|$)/i.test(
        source.description.trim(),
      );
    if (highConfidence && (!statedMask || statedMask === brokerage?.mask))
      return decision({
        kind: "internal_transfer",
        status: "confirmed",
        category: "Internal transfer",
        reason:
          "Recognized checking ↔ selected brokerage transfer, including one-sided funding",
      });
    if (
      /brokerage|overdraft|securit(?:y|ies)|investment transfer/i.test(
        source.description,
      )
    )
      return decision({
        reason:
          "Possible internal movement; selected counterparty is unverified",
      });
    if (source.amountCents === 0) return ignore("Zero-value cash event");
    if (source.amountCents > 0)
      return decision({
        kind: "cash_income",
        status: "confirmed",
        category: /payroll|salary|direct deposit/i.test(source.description)
          ? "Payroll"
          : "Other deposits",
        reason:
          "Posted external checking receipt under the cash-boundary convention",
      });
    return decision({
      kind: "spending",
      status: "confirmed",
      category: /card|amex|visa|mastercard|discover/i.test(source.description)
        ? "Credit-card payments"
        : (source.category ?? "Other payments"),
      reason:
        "Posted checking payment outside the two-account boundary; card purchases are not imported",
    });
  }
  if (account.role !== "joint_brokerage")
    return ignore("Investment is outside the selected brokerage role");
  if (source.activity !== "transfer") {
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
  if (source.origin === "internal" || counterpart)
    return ignore("Investment transfer is internal to the account boundary");
  if (source.direction === "out")
    return ignore("Outgoing securities are outside this income measure");
  if (
    !source.securityId ||
    !source.quantity ||
    !positiveDecimal(source.quantity) ||
    source.direction !== "in" ||
    source.origin !== "external" ||
    !source.evidence
  )
    return decision({
      reason:
        "Verify incoming direction, external origin, security identity and exact quantity",
    });
  if (!valuation)
    return decision({
      reason:
        "Missing historical closing price; current quotes are never substituted",
    });
  try {
    return decision({
      kind: "stock_income",
      status: "confirmed",
      amountCents: validateValuation(source, valuation),
      valuation,
      category: "Stock transfers",
      reason:
        "Verified external securities receipt valued at arrival-date historical close",
    });
  } catch {
    return decision({
      reason: "Historical price or receipt metadata requires review",
    });
  }
}

/** Amount/date alone is insufficient: require a unique candidate with a shared reference. */
export function transferMatches(
  sources: Source[],
  accounts: Account[],
): Set<string> {
  const checking = accounts.find((a) => a.role === "joint_checking")?.id;
  const brokerage = accounts.find((a) => a.role === "joint_brokerage")?.id;
  const candidates = new Map<string, string[]>();
  for (const bank of sources) {
    if (
      bank.kind !== "bank" ||
      bank.accountId !== checking ||
      bank.pending ||
      bank.removed ||
      !bank.transferReference
    )
      continue;
    const matches = sources.filter(
      (other): other is InvestmentSource =>
        other.kind === "investment" &&
        other.accountId === brokerage &&
        !other.removed &&
        other.activity === "cash" &&
        other.currency === bank.currency &&
        other.transferReference === bank.transferReference &&
        other.cashAmountCents === -bank.amountCents &&
        daysApart(bank.date, other.date) <= 3,
    );
    if (matches.length === 1)
      candidates.set(eventId(bank), [eventId(matches[0])]);
  }
  const result = new Set<string>();
  for (const [bank, [investment]] of candidates) {
    if (
      [...candidates.values()].filter(([id]) => id === investment).length === 1
    )
      result.add(bank);
  }
  return result;
}
