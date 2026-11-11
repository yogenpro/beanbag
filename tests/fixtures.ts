import type {
  Account,
  BankSource,
  InvestmentSource,
  Override,
  Valuation,
} from "../src/accounting/types";
export const accounts: Account[] = [
  {
    id: "test-checking",
    role: "joint_checking",
    label: "Test checking",
    mask: "0001",
  },
  {
    id: "test-brokerage",
    role: "joint_brokerage",
    label: "Test brokerage",
    mask: "0002",
  },
];
export const bank = (patch: Partial<BankSource> = {}): BankSource => ({
  kind: "bank",
  id: "bank-1",
  accountId: accounts[0].id,
  date: "2026-08-10",
  description: "Payroll",
  amountCents: 400000,
  pending: false,
  currency: "USD",
  revision: "v1",
  ...patch,
});
export const investment = (
  patch: Partial<InvestmentSource> = {},
): InvestmentSource => ({
  kind: "investment",
  id: "stock-1",
  accountId: accounts[1].id,
  date: "2026-08-10",
  description: "External receipt of XYZ",
  currency: "USD",
  revision: "v1",
  activity: "transfer",
  securityId: "test-xyz",
  ticker: "XYZ",
  quantity: "100",
  cashAmountCents: 0,
  direction: "in",
  origin: "external",
  evidence: "Synthetic receipt confirmation",
  ...patch,
});
export const valuation = (patch: Partial<Valuation> = {}): Valuation => ({
  securityId: "test-xyz",
  quantity: "100",
  eventDate: "2026-08-10",
  close: "200",
  priceDate: "2026-08-10",
  currency: "USD",
  provider: "Synthetic historical close",
  retrievedAt: "2026-08-11T12:00:00Z",
  convention: "last_session_close",
  ...patch,
});
export const override = (patch: Partial<Override> = {}): Override => ({
  id: "review-1",
  eventId: "bank:bank-1",
  baseRevision: "v1",
  kind: "ignored",
  rationale: "Verified with synthetic institution evidence",
  actor: "test-reviewer",
  createdAt: "2026-08-12T12:00:00Z",
  ...patch,
});
export const rawBank = (patch: Record<string, unknown> = {}) => ({
  account_id: accounts[0].id,
  transaction_id: "provider-bank-1",
  date: "2026-08-10",
  name: "Payroll",
  amount: "-4000.00",
  iso_currency_code: "USD",
  pending: false,
  ...patch,
});
export const rawInvestment = (patch: Record<string, unknown> = {}) => ({
  account_id: accounts[1].id,
  investment_transaction_id: "provider-investment-1",
  date: "2026-08-10",
  name: "Synthetic security transfer",
  type: "transfer",
  subtype: "transfer",
  amount: "0",
  quantity: "100",
  security_id: "test-xyz",
  iso_currency_code: "USD",
  cancel_transaction_id: null,
  ...patch,
});
