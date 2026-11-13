import type {
  AccountBalance,
  BalanceSnapshot,
} from "../../accounting/balances";
import { cents } from "../../accounting/money";
import type { Account } from "../../accounting/types";
import type { LedgerRepository } from "../../data/repository";
import {
  decimalText,
  ProviderError,
  type JsonRecord,
  type PlaidApi,
} from "./client";

function normalize(account: Account, rows: unknown): AccountBalance {
  if (!Array.isArray(rows)) throw new ProviderError("INVALID_BALANCE_RESPONSE");
  const matches = rows.filter((r) => r && r.account_id === account.id);
  if (matches.length !== 1 || !matches[0].balances)
    throw new ProviderError("SELECTED_BALANCE_ACCOUNT_MISSING");
  const raw = matches[0] as JsonRecord;
  if (
    (account.role === "joint_checking" &&
      (raw.type !== "depository" || raw.subtype !== "checking")) ||
    (account.role === "joint_brokerage" && raw.type !== "investment")
  )
    throw new ProviderError("BALANCE_ACCOUNT_TYPE_CHANGED");
  const b = raw.balances as JsonRecord;
  const currency =
    typeof b.iso_currency_code === "string" && !b.unofficial_currency_code
      ? b.iso_currency_code
      : null;
  const value = (input: unknown) =>
    input === null || input === undefined ? null : cents(decimalText(input));
  const marginLoanCents =
    account.role === "joint_checking" ? 0 : value(b.margin_loan_amount);
  if (marginLoanCents !== null && marginLoanCents < 0)
    throw new ProviderError("INVALID_MARGIN_BALANCE");
  return {
    accountId: account.id,
    currentCents: currency === "USD" ? value(b.current) : null,
    marginLoanCents: currency === "USD" ? marginLoanCents : null,
    currency,
    institutionUpdatedAt:
      typeof b.last_updated_datetime === "string" &&
      Number.isFinite(Date.parse(b.last_updated_datetime))
        ? new Date(b.last_updated_datetime).toISOString()
        : null,
  };
}

export async function collectBalances(
  api: PlaidApi,
  repo: LedgerRepository,
  token: string,
  now = () => new Date(),
): Promise<void> {
  try {
    const accounts = await repo.accounts();
    const checking = accounts.find((a) => a.role === "joint_checking");
    const brokerage = accounts.find((a) => a.role === "joint_brokerage");
    if (accounts.length !== 2 || !checking || !brokerage)
      throw new ProviderError("ACCOUNT_CONFIGURATION_REQUIRED");
    // Existing product data only. No paid real-time Balance or Investments Refresh call.
    // Holdings' account balance supplies margin borrowing; never add holdings on top of it.
    const cash = await api.post("/accounts/get", {
      access_token: token,
      options: { account_ids: [checking.id] },
    });
    const investments = await api.post("/investments/holdings/get", {
      access_token: token,
      options: { account_ids: [brokerage.id] },
    });
    const snapshot: BalanceSnapshot = {
      capturedAt: now().toISOString(),
      provider: "Plaid /accounts/get + /investments/holdings/get (cached)",
      accounts: [
        normalize(checking, cash.accounts),
        normalize(brokerage, investments.accounts),
      ],
    };
    await repo.saveBalanceSnapshot(snapshot);
  } catch (error) {
    await repo.failBalanceRefresh(
      now().toISOString(),
      error instanceof ProviderError ? error.code : "BALANCE_REFRESH_FAILED",
    );
    throw error;
  }
}
