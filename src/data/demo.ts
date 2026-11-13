import { MemoryLedger } from "./memory";
import { pacificToday } from "../accounting/dates";
import type {
  Account,
  BankSource,
  InvestmentSource,
  Source,
  Valuation,
} from "../accounting/types";

// Invented records only. No original handoff, real masks, financial exports or identities.
export function demoLedger(now = new Date()): MemoryLedger {
  const accounts: Account[] = [
    {
      id: "demo-checking",
      role: "joint_checking",
      label: "Joint checking",
      mask: "0001",
    },
    {
      id: "demo-brokerage",
      role: "joint_brokerage",
      label: "Joint brokerage",
      mask: "0002",
    },
  ];
  const today = pacificToday(now),
    current = today.slice(0, 7),
    [year, month] = today.split("-").map(Number);
  const sources: Source[] = [];
  const bank = (
    id: string,
    date: string,
    description: string,
    amountCents: number,
    category?: string,
    pending = false,
  ): BankSource => ({
    kind: "bank",
    id,
    date,
    description,
    amountCents,
    category,
    pending,
    accountId: accounts[0].id,
    currency: "USD",
    revision: "synthetic-v1",
  });
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1))
      .toISOString()
      .slice(0, 7);
    const seed = 5 - offset;
    sources.push(
      bank(
        `salary-${date}`,
        `${date}-01`,
        "Example Co · Payroll",
        620000 + seed * 14000,
      ),
    );
    sources.push(
      bank(
        `card-${date}`,
        `${date}-02`,
        "Everyday card · Payment",
        -(245000 + seed * 9000),
      ),
    );
    sources.push(
      bank(`home-${date}`, `${date}-03`, "Home payment", -210000, "Home"),
    );
    sources.push(
      bank(
        `utilities-${date}`,
        `${date}-04`,
        "City utilities",
        -(18700 + seed * 1100),
        "Utilities",
      ),
    );
    sources.push(
      bank(
        `deposit-${date}`,
        `${date}-05`,
        "External reimbursement",
        12500 + seed * 2500,
      ),
    );
    sources.push(
      bank(
        `brokerage-${date}`,
        `${date}-06`,
        "Transfer to Brokerage -0002",
        -80000,
      ),
    );
  }
  const receipt: InvestmentSource = {
    kind: "investment",
    id: "demo-stock-arrival",
    accountId: accounts[1].id,
    date: `${current}-01`,
    description: "EXM · External share receipt",
    currency: "USD",
    revision: "synthetic-v1",
    activity: "transfer",
    securityId: "example-security",
    ticker: "EXM",
    quantity: "42.5",
    cashAmountCents: 0,
    direction: "in",
    origin: "external",
    evidence: "Invented transfer receipt for illustrative preview",
  };
  sources.push(receipt);
  sources.push({
    ...receipt,
    id: "demo-review-stock",
    date: `${current}-01`,
    description: "EXM · Share transfer",
    quantity: "12",
    origin: "unknown",
    direction: "unknown",
    evidence: undefined,
  });
  sources.push({
    ...receipt,
    id: "demo-automatic-stock",
    description: "EXM · Recorded share transfer",
    quantity: "7.25",
    unitPrice: "186.125",
    origin: "unknown",
    direction: "unknown",
    evidence: undefined,
  });
  sources.push({
    ...receipt,
    id: "demo-outgoing-stock",
    description: "EXM · External share withdrawal",
    quantity: "-1.5",
    unitPrice: "186.125",
    origin: "unknown",
    direction: "unknown",
    evidence: undefined,
  });
  sources.push(
    bank("demo-review-bank", `${current}-01`, "External cash transfer", -47500),
  );
  sources.push(
    bank(
      "demo-pending",
      today,
      "Card payment · Pending",
      -32500,
      "Credit-card payments",
      true,
    ),
  );
  // Avoid future-dated illustration entries early in a month.
  const repo = new MemoryLedger(
    accounts,
    sources.filter((s) => s.date <= today),
  );
  // Invented daily balances, independent of synthetic receipt/transaction totals.
  for (let day = 179; day >= 0; day--) {
    const capturedAt = new Date(now.getTime() - day * 86_400_000).toISOString();
    const step = 179 - day;
    repo.snapshots.push({
      capturedAt,
      provider: "Illustrative account balances",
      accounts: [
        {
          accountId: accounts[0].id,
          currentCents: 1860000 + (step % 30) * 12500 - (step % 7) * 4200,
          marginLoanCents: 0,
          currency: "USD",
          institutionUpdatedAt: capturedAt,
        },
        {
          accountId: accounts[1].id,
          currentCents:
            26400000 + step * 21000 + Math.round(Math.sin(step / 8) * 360000),
          marginLoanCents: 0,
          currency: "USD",
          institutionUpdatedAt: capturedAt,
        },
      ],
    });
  }
  repo.balanceStatus = {
    lastAttempt: now.toISOString(),
    lastSuccess: now.toISOString(),
    error: null,
  };
  const latest = repo.snapshots.at(-1)!;
  latest.accounts[1].marginLoanCents = 87000;
  latest.borrowingConfirmation = {
    accountId: accounts[1].id,
    actor: "illustrative-owner",
    confirmedAt: latest.capturedAt,
    amountCents: 0,
  };
  const priceDate = receipt.date;
  const valuation: Valuation = {
    securityId: receipt.securityId!,
    quantity: receipt.quantity!,
    eventDate: receipt.date,
    close: "184.32",
    priceDate,
    currency: "USD",
    provider: "Illustrative historical quote",
    retrievedAt: now.toISOString(),
    convention: "last_session_close",
  };
  repo.prices["investment:demo-stock-arrival"] = valuation;
  repo.health = repo.health.map((h) => ({
    ...h,
    lastSuccess: now.toISOString(),
    lastAttempt: now.toISOString(),
    mostRecentDate: today,
    startDate: sources[0].date,
    limitation:
      "Illustrative data only. No bank is connected; freshness timestamps are simulated.",
  }));
  return repo;
}
