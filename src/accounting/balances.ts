import { pacificToday, type Period } from "./dates";
import { sumCents } from "./money";
import type { Account } from "./types";
import type { HistoricalValue } from "./history";

// Balance observations are independent of receipt valuations and financial events.
export type AccountBalance = {
  accountId: string;
  currentCents: number | null;
  marginLoanCents: number | null;
  currency: string | null;
  institutionUpdatedAt: string | null;
  // Institution history may supply an already-net account value without a loan breakdown.
  netValueCents?: number | null;
};
export type BalanceSnapshot = {
  capturedAt: string;
  provider: string;
  accounts: AccountBalance[];
  asOfDate?: string;
  historyMethods?: HistoricalValue["method"][];
  // Legacy evidence stays in stored observations; it never overrides balances.
  borrowingConfirmation?: {
    accountId: string;
    confirmedAt: string;
    actor: string;
    amountCents: 0;
  };
};
export type BalanceHealth = {
  lastAttempt: string | null;
  lastSuccess: string | null;
  error: string | null;
};
export const emptyBalanceHealth = (): BalanceHealth => ({
  lastAttempt: null,
  lastSuccess: null,
  error: null,
});
export type BalancePoint = BalanceSnapshot & {
  date: string;
  assetsCents: number | null;
  marginLoanCents: number | null;
  netWorthCents: number | null;
};

export function balancePoint(
  snapshot: BalanceSnapshot,
  accounts: Account[],
): BalancePoint {
  const checking = accounts.find((a) => a.role === "joint_checking");
  const brokerage = accounts.find((a) => a.role === "joint_brokerage");
  const balances = accounts.map((a) =>
    snapshot.accounts.find((b) => b.accountId === a.id),
  );
  const complete =
    accounts.length === 2 &&
    checking &&
    brokerage &&
    snapshot.accounts.length === 2 &&
    balances.every((b) => b?.currency === "USD" && b.currentCents !== null);
  const assetsCents = complete
    ? sumCents(balances.map((b) => b!.currentCents!))
    : null;
  const marginLoanCents =
    snapshot.accounts.find((b) => b.accountId === brokerage?.id)
      ?.marginLoanCents ?? null;
  return {
    ...snapshot,
    date: snapshot.asOfDate ?? pacificToday(new Date(snapshot.capturedAt)),
    assetsCents,
    marginLoanCents,
    netWorthCents:
      accounts.length === 2 &&
      checking &&
      brokerage &&
      snapshot.accounts.length === 2 &&
      balances.every(
        (b) =>
          b?.currency === "USD" &&
          b.netValueCents !== undefined &&
          b.netValueCents !== null,
      )
        ? sumCents(balances.map((b) => b!.netValueCents!))
        : assetsCents !== null && marginLoanCents !== null
          ? sumCents([assetsCents, -marginLoanCents])
          : null,
  };
}

export function balanceReport(
  snapshots: BalanceSnapshot[],
  accounts: Account[],
  health: BalanceHealth,
  period: Period,
  now = new Date(),
  historical: HistoricalValue[] = [],
) {
  // A changed account selection must never splice two different boundaries together.
  const ids = accounts
    .map((a) => a.id)
    .sort()
    .join("\n");
  const points = snapshots
    .filter(
      (s) =>
        s.accounts
          .map((a) => a.accountId)
          .sort()
          .join("\n") === ids,
    )
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .map((s) => balancePoint(s, accounts));
  const daily = new Map<string, BalancePoint>();
  const imports = new Map<string, Map<string, HistoricalValue>>();
  for (const value of historical.filter((v) =>
    accounts.some((a) => a.id === v.accountId),
  )) {
    const day = imports.get(value.date) ?? new Map<string, HistoricalValue>();
    const previous = day.get(value.accountId);
    if (
      !previous ||
      (value.method === "institution_export" &&
        previous.method !== "institution_export") ||
      (previous.method === value.method &&
        value.calculatedAt > previous.calculatedAt)
    )
      day.set(value.accountId, value);
    imports.set(value.date, day);
  }
  const importedPoints: BalancePoint[] = [];
  for (const [date, values] of imports) {
    if (accounts.length !== 2 || !accounts.every((a) => values.has(a.id)))
      continue;
    const rows = accounts.map((a) => values.get(a.id)!);
    const point = balancePoint(
      {
        capturedAt: rows
          .map((v) => v.calculatedAt)
          .sort()
          .at(-1)!,
        asOfDate: date,
        provider: [...new Set(rows.map((v) => v.source))].join(" + "),
        historyMethods: [...new Set(rows.map((v) => v.method))],
        accounts: rows.map((v) => ({
          accountId: v.accountId,
          currentCents: v.assetsCents,
          marginLoanCents: v.borrowingCents,
          netValueCents: v.netValueCents,
          currency: "USD",
          institutionUpdatedAt: null,
        })),
      },
      accounts,
    );
    importedPoints.push(point);
  }
  const combined = [...importedPoints, ...points].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.capturedAt.localeCompare(b.capturedAt),
  );
  const latest = combined.at(-1) ?? null;
  for (const point of combined)
    if (point.date >= period.start && point.date <= period.end)
      daily.set(point.date, point);
  return {
    latest,
    history: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    health,
    stale:
      !!latest &&
      (now.getTime() - Date.parse(latest.capturedAt) > 36 * 60 * 60_000 ||
        (!!latest.asOfDate &&
          Date.parse(pacificToday(now)) - Date.parse(latest.asOfDate) >
            2 * 86400000) ||
        latest.accounts.some(
          (a) =>
            a.institutionUpdatedAt &&
            now.getTime() - Date.parse(a.institutionUpdatedAt) >
              36 * 60 * 60_000,
        )),
  };
}
export type BalanceReport = ReturnType<typeof balanceReport>;
