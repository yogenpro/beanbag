import type { HistoricalValue } from "../../accounting/history";
import { cents } from "../../accounting/money";
import { validDate } from "../../accounting/dates";
import { decimalText, ProviderError, type JsonRecord } from "./client";
import { rawJson } from "./client";
import { normalizeBank } from "./normalize";
import type { SourceWrite } from "../../data/repository";

/** Reuse settled transactions from an authorized Assets report, preserving provider IDs. */
export async function checkingAssetTransactions(
  report: JsonRecord,
  checkingId: string,
): Promise<SourceWrite[]> {
  if (
    report.accountId !== checkingId ||
    !Array.isArray(report.transactions) ||
    report.transactions.length > 5000
  )
    throw new ProviderError("INVALID_ASSET_TRANSACTIONS");
  const ids = new Set<string>();
  const writes: SourceWrite[] = [];
  for (const raw of report.transactions as JsonRecord[]) {
    if (
      raw.account_id !== checkingId ||
      typeof raw.transaction_id !== "string" ||
      !raw.transaction_id ||
      ids.has(raw.transaction_id) ||
      raw.pending !== false ||
      raw.iso_currency_code !== "USD" ||
      raw.unofficial_currency_code
    )
      throw new ProviderError("INVALID_ASSET_TRANSACTIONS");
    ids.add(raw.transaction_id);
    const write = await normalizeBank({
      ...raw,
      name: raw.name ?? raw.original_description,
    });
    writes.push({
      ...write,
      raw: rawJson({
        product: "assets",
        retrievedFromReport: report.generatedAt,
        transaction: raw,
      }),
    });
  }
  return writes;
}

export function checkingAssetValues(
  report: JsonRecord,
  checkingId: string,
  at: string,
): HistoricalValue[] {
  const accounts = (report.items ?? [])
    .flatMap((i: JsonRecord) => i.accounts ?? [])
    .filter((a: JsonRecord) => a.account_id === checkingId);
  if (
    accounts.length !== 1 ||
    accounts[0].type !== "depository" ||
    accounts[0].subtype !== "checking"
  )
    throw new ProviderError("ASSETS_CHECKING_MISSING");
  const seen = new Set<string>();
  return (accounts[0].historical_balances ?? []).map((b: JsonRecord) => {
    if (
      !validDate(b.date) ||
      seen.has(b.date) ||
      b.iso_currency_code !== "USD" ||
      b.unofficial_currency_code
    )
      throw new ProviderError("INVALID_ASSET_HISTORY");
    seen.add(b.date);
    const value = cents(decimalText(b.current));
    return {
      accountId: checkingId,
      date: b.date,
      calculatedAt: at,
      method: "plaid_assets",
      netValueCents: value,
      assetsCents: value,
      borrowingCents: 0,
      source: "Plaid Assets calculated historical balances",
    };
  });
}
