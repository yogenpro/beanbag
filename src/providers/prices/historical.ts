import type { InvestmentSource, Valuation } from "../../accounting/types";
import { validateValuation } from "../../accounting/classify";

export interface HistoricalPriceProvider {
  /** Return an unadjusted USD closing price for the last trading session on/before arrival. */
  arrivalClose(receipt: InvestmentSource): Promise<Valuation | null>;
}

/** Reviewed, historical quotes supplied by the user with explicit source/date evidence.
 * Deliberate M0 fallback while provider entitlements and Schwab receipts are unverified.
 */
export class ReviewedHistoricalPrices implements HistoricalPriceProvider {
  constructor(private readonly quotes: Valuation[]) {}
  async arrivalClose(receipt: InvestmentSource): Promise<Valuation | null> {
    const quote = this.quotes.find(
      (q) =>
        q.securityId === receipt.securityId &&
        q.eventDate === receipt.date &&
        q.quantity === receipt.quantity,
    );
    if (!quote) return null;
    validateValuation(receipt, quote);
    return { ...quote };
  }
}
