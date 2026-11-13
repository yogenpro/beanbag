export type Account = {
  id: string;
  role: "joint_checking" | "joint_brokerage";
  label: string;
  mask: string;
};
type CommonSource = {
  id: string;
  accountId: string;
  date: string;
  description: string;
  currency: string;
  revision: string;
  removed?: boolean;
  counterpartAccountId?: string;
  transferReference?: string;
};
export type BankSource = CommonSource & {
  kind: "bank";
  amountCents: number;
  pending: boolean;
  pendingId?: string;
  category?: string;
};
export type InvestmentSource = CommonSource & {
  kind: "investment";
  activity: string;
  subtype?: string;
  securityId?: string;
  ticker?: string;
  securityType?: string;
  quantity?: string;
  unitPrice?: string;
  cashAmountCents: number;
  direction: "in" | "out" | "unknown";
  origin: "external" | "internal" | "unknown";
  evidence?: string;
  cancelledId?: string;
  manual?: boolean;
};
export type Source = BankSource | InvestmentSource;
export type EventKind =
  | "cash_income"
  | "stock_income"
  | "stock_spending"
  | "spending"
  | "internal_transfer"
  | "ignored"
  | "unknown";
export type Valuation = {
  securityId: string;
  quantity: string;
  eventDate: string;
  close: string;
  priceDate: string;
  currency: "USD";
  provider: string;
  retrievedAt?: string;
  // Recorded transfer prices are distinct from reviewed market-closing prices.
  convention: "last_session_close" | "provider_transfer_price";
};
export type Override = {
  id: string;
  eventId: string;
  baseRevision: string;
  kind: EventKind;
  date?: string;
  valuation?: Valuation;
  rationale: string;
  actor: string;
  createdAt: string;
};
export type FinancialEvent = {
  id: string;
  sourceId: string;
  sourceType: Source["kind"];
  accountId: string;
  date: string;
  description: string;
  kind: EventKind;
  status: "confirmed" | "needs_review" | "pending" | "removed";
  amountCents: number | null;
  category: string;
  reason: string;
  ruleVersion: string;
  revision: string;
  valuation?: Valuation;
  overrideId?: string;
  transferGroup?: string;
};
export type Coverage = {
  product: "checking" | "investments";
  lastSuccess: string | null;
  lastAttempt: string | null;
  mostRecentDate: string | null;
  completeThrough: string | null;
  error: string | null;
  startDate: string | null;
  limitation: string;
};
export const eventId = (source: Pick<Source, "kind" | "id">): string =>
  `${source.kind}:${source.id}`;
