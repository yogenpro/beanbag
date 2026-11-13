import { decimalIdentity, positiveDecimal } from "./money";
import type { InvestmentSource, Source } from "./types";

export const absoluteQuantity = (quantity?: string) =>
  quantity?.replace(/^-/, "");

const excludedCash =
  /dividend|interest|reinvest|fee|tax|capital.gain|return.of.capital/i;

export function investmentTransfer(source: InvestmentSource): boolean {
  if (source.activity === "transfer") return true;
  if (source.activity !== "cash" || excludedCash.test(source.subtype ?? ""))
    return false;
  if (
    /transfer|deposit|withdraw|contribution|distribution/i.test(
      source.subtype ?? "",
    )
  )
    return true;
  return (
    !excludedCash.test(source.description) &&
    /transfer|deposit|withdraw|contribution|distribution/i.test(
      source.description,
    )
  );
}

export function cashMovement(source: Source): boolean {
  return (
    source.kind === "bank" ||
    source.activity === "cash" ||
    source.securityType === "cash" ||
    /^CUR:/i.test(source.ticker ?? "") ||
    (!source.securityId &&
      !positiveDecimal(absoluteQuantity(source.quantity) ?? "0"))
  );
}

export function movementDirection(source: Source): "in" | "out" | "unknown" {
  if (cashMovement(source)) {
    const amount =
      source.kind === "bank" ? source.amountCents : source.cashAmountCents;
    return amount > 0 ? "in" : amount < 0 ? "out" : "unknown";
  }
  if (source.kind === "investment") {
    if (source.direction !== "unknown") return source.direction;
    if (
      /(?:^|[_ -])(?:out|outgoing|withdrawal|delivery)(?:$|[_ -])/i.test(
        source.subtype ?? "",
      )
    )
      return "out";
    if (
      /(?:^|[_ -])(?:in|incoming|deposit|receipt)(?:$|[_ -])/i.test(
        source.subtype ?? "",
      )
    )
      return "in";
    if (positiveDecimal(absoluteQuantity(source.quantity) ?? "0"))
      return source.quantity!.startsWith("-") ? "out" : "in";
  }
  return "unknown";
}

export function transferCandidate(source: Source): boolean {
  if (source.removed || (source.kind === "bank" && source.pending))
    return false;
  if (source.kind === "investment")
    return (
      investmentTransfer(source) ||
      (source.activity === "cash" &&
        !!source.transferReference &&
        !excludedCash.test(`${source.subtype ?? ""} ${source.description}`))
    );
  return (
    !!source.counterpartAccountId ||
    !!source.transferReference ||
    /transfer|overdraft|moneylink|\bach\b|\beft\b|\bwire\b/i.test(
      `${source.description} ${source.category ?? ""}`,
    )
  );
}

export function oppositeMovement(left: Source, right: Source): boolean {
  const direction = movementDirection(left),
    otherDirection = movementDirection(right);
  if (
    direction === "unknown" ||
    otherDirection === "unknown" ||
    direction === otherDirection
  )
    return false;
  if (cashMovement(left) !== cashMovement(right)) return false;
  if (cashMovement(left)) {
    const amount = (source: Source) =>
      source.kind === "bank" ? source.amountCents : source.cashAmountCents;
    return amount(left) === -amount(right);
  }
  return (
    left.kind === "investment" &&
    right.kind === "investment" &&
    !!left.securityId &&
    left.securityId === right.securityId &&
    positiveDecimal(absoluteQuantity(left.quantity) ?? "0") &&
    positiveDecimal(absoluteQuantity(right.quantity) ?? "0") &&
    decimalIdentity(absoluteQuantity(left.quantity)!) ===
      decimalIdentity(absoluteQuantity(right.quantity)!)
  );
}
