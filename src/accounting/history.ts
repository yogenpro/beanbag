export type HistoricalValue = {
  accountId: string;
  date: string;
  calculatedAt: string;
  method: "plaid_assets" | "institution_export";
  netValueCents: number | null;
  assetsCents: number | null;
  borrowingCents: number | null;
  source: string;
};
import { validDate } from "./dates";
import type { Account } from "./types";

export function validateHistory(
  values: HistoricalValue[],
  accounts: Account[],
) {
  if (values.length > 10000) throw new Error("History batch exceeds limit");
  const keys = new Set<string>();
  for (const v of values) {
    const account = accounts.find((a) => a.id === v.accountId);
    if (
      !account ||
      !validDate(v.date) ||
      !Number.isFinite(Date.parse(v.calculatedAt)) ||
      !["plaid_assets", "institution_export"].includes(v.method) ||
      typeof v.source !== "string" ||
      !v.source ||
      v.source.length > 250 ||
      /[\r\n]/.test(v.source) ||
      [v.netValueCents, v.assetsCents, v.borrowingCents].some(
        (n) => n !== null && !Number.isSafeInteger(n),
      ) ||
      (v.borrowingCents !== null && v.borrowingCents < 0) ||
      (v.method === "plaid_assets" && account.role !== "joint_checking")
    )
      throw new Error("Invalid account history");
    if (
      v.assetsCents !== null &&
      v.borrowingCents !== null &&
      v.netValueCents !== v.assetsCents - v.borrowingCents
    )
      throw new Error("Historical values do not reconcile");
    const key = [v.accountId, v.date, v.method].join(":");
    if (keys.has(key)) throw new Error("Duplicate history value");
    keys.add(key);
  }
}
