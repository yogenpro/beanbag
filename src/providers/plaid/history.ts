import type { HistoricalValue } from "../../accounting/history";
import { cents } from "../../accounting/money";
import { validDate } from "../../accounting/dates";
import { decimalText, ProviderError, type JsonRecord } from "./client";

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
