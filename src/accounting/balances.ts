import { pacificToday, type Period } from "./dates";
import { sumCents } from "./money";
import type { Account } from "./types";

// Balance observations are independent of receipt valuations and financial events.
export type AccountBalance = {
  accountId: string;
  currentCents: number | null;
  marginLoanCents: number | null;
  currency: string | null;
  institutionUpdatedAt: string | null;
};
export type BalanceSnapshot = {
  capturedAt: string;
  provider: string;
  accounts: AccountBalance[];
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
  borrowingConflict: boolean;
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
  const reportedMargin =
    snapshot.accounts.find((b) => b.accountId === brokerage?.id)
      ?.marginLoanCents ?? null;
  const confirmation = snapshot.borrowingConfirmation;
  const marginLoanCents =
    reportedMargin ??
    (confirmation?.accountId === brokerage?.id &&
    confirmation?.amountCents === 0 &&
    confirmation.actor &&
    pacificToday(new Date(confirmation.confirmedAt)) ===
      pacificToday(new Date(snapshot.capturedAt))
      ? 0
      : null);
  const borrowingConflict =
    !!confirmation &&
    confirmation.accountId === brokerage?.id &&
    confirmation.amountCents === 0 &&
    reportedMargin !== null &&
    reportedMargin > 0;
  return {
    ...snapshot,
    date: pacificToday(new Date(snapshot.capturedAt)),
    assetsCents,
    marginLoanCents,
    borrowingConflict,
    netWorthCents:
      assetsCents !== null && marginLoanCents !== null && !borrowingConflict
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
  const latest = points.at(-1) ?? null;
  const daily = new Map<string, BalancePoint>();
  for (const point of points)
    if (point.date >= period.start && point.date <= period.end)
      daily.set(point.date, point);
  return {
    latest,
    history: [...daily.values()],
    health,
    stale:
      !!latest &&
      (now.getTime() - Date.parse(latest.capturedAt) > 36 * 60 * 60_000 ||
        latest.accounts.some(
          (a) =>
            a.institutionUpdatedAt &&
            now.getTime() - Date.parse(a.institutionUpdatedAt) >
              36 * 60 * 60_000,
        )),
  };
}
export type BalanceReport = ReturnType<typeof balanceReport>;
