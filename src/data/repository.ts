import { classify, transferMatches } from "../accounting/classify";
import { decimalIdentity, positiveDecimal } from "../accounting/money";
import {
  eventId,
  type Account,
  type Coverage,
  type FinancialEvent,
  type Override,
  type Source,
  type Valuation,
} from "../accounting/types";

export type SourceWrite = { record: Source; raw: string };
export type SyncCommit = {
  product: Coverage["product"];
  leaseId: string;
  writes: SourceWrite[];
  removed: string[];
  cursor: string | null;
  coverage: Coverage;
  reconcileWindow?: { start: string; end: string; presentIds: string[] };
};
export interface LedgerRepository {
  accounts(): Promise<Account[]>;
  sources(): Promise<Source[]>;
  events(): Promise<FinancialEvent[]>;
  overrides(): Promise<Override[]>;
  valuations(): Promise<Record<string, Valuation>>;
  coverage(): Promise<Coverage[]>;
  cursor(product: Coverage["product"]): Promise<string | null>;
  acquire(product: Coverage["product"], now: string): Promise<string | null>;
  commitSync(commit: SyncCommit): Promise<void>;
  failSync(
    product: Coverage["product"],
    leaseId: string,
    now: string,
    code: string,
  ): Promise<void>;
  saveOverride(override: Override): Promise<FinancialEvent>;
  saveManual(write: SourceWrite, override: Override): Promise<void>;
}

export function reclassify(
  sources: Source[],
  accounts: Account[],
  overrides: Override[],
  valuations: Record<string, Valuation>,
): FinancialEvent[] {
  const matches = transferMatches(sources, accounts);
  const latest = new Map(overrides.map((o) => [o.eventId, o]));
  const events = sources.map((s) =>
    classify(
      s,
      accounts,
      latest.get(eventId(s)),
      valuations[eventId(s)],
      matches.has(eventId(s)),
    ),
  );
  for (const event of events) {
    if (event.kind !== "stock_income" || event.status !== "confirmed") continue;
    const source = sources.find((s) => eventId(s) === event.id)!;
    if (source.kind !== "investment") continue;
    const duplicates = sources.filter(
      (s) =>
        s.kind === "investment" &&
        !s.removed &&
        s.activity === "transfer" &&
        s.accountId === source.accountId &&
        s.date === source.date &&
        s.securityId === source.securityId &&
        s.quantity !== undefined &&
        source.quantity !== undefined &&
        positiveDecimal(s.quantity) &&
        positiveDecimal(source.quantity) &&
        decimalIdentity(s.quantity) === decimalIdentity(source.quantity) &&
        eventId(s) !== event.id &&
        events.find((e) => e.id === eventId(s))?.kind !== "ignored",
    );
    if (duplicates.length) {
      event.status = "needs_review";
      event.reason =
        "Possible duplicate share receipt; reconcile manual and provider evidence before counting";
    }
  }
  return events;
}

export function defaultCoverage(product: Coverage["product"]): Coverage {
  return {
    product,
    lastSuccess: null,
    lastAttempt: null,
    mostRecentDate: null,
    completeThrough: null,
    error: null,
    startDate: null,
    limitation:
      product === "investments"
        ? "Incoming-share coverage is unverified. A real transfer must be checked against institution evidence; use reviewed manual receipts meanwhile."
        : "Not connected. Provider refresh times do not establish a complete-through date.",
  };
}
