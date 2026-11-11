import type {
  Account,
  Coverage,
  FinancialEvent,
  Source,
  Override,
} from "../accounting/types";
import type { Report } from "../accounting/report";
export type Dashboard = Report & {
  accounts: Account[];
  coverage: Coverage[];
  illustrative: boolean;
  actor: { admin: boolean };
  connectionStatus: string;
  trend: Report["months"];
};
export type Detail = {
  event: FinancialEvent;
  source: Source;
  history: Override[];
};
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { credentials: "same-origin" }
      : {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Beanbag-Request": "1",
          },
          body: JSON.stringify(body),
        },
  );
  const payload = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new Error(payload.error ?? "Unable to load the household ledger");
  return payload as T;
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
export function displayDate(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
