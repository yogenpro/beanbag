import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PlaidClient,
  ProviderError,
  type JsonRecord,
} from "../../src/providers/plaid/client";
import { SyncService } from "../../src/providers/plaid/sync";
import { D1Ledger } from "../../src/data/d1";
import { report } from "../../src/accounting/report";
import { selectAccounts } from "../../src/api/onboarding";
import type { Account } from "../../src/accounting/types";
import { sqliteD1 } from "../sqlite-d1";

// Explicit suite, never discovered by the normal credential-free test command.
// No caller-provided host/environment: all HTTP requests use Plaid Sandbox.
describe("Plaid Sandbox → normalization → SQLite → accounting", () => {
  let api: PlaidClient,
    token: string | undefined,
    selected: Account[],
    repo: D1Ledger;
  let database: ReturnType<typeof sqliteD1> | undefined;
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const descriptions = {
    income: `Beanbag Sandbox ${run} Payroll`,
    card: `Beanbag Sandbox ${run} Card payment`,
    internal: `Transfer to Brokerage ${run}`,
    zelle: `Beanbag Sandbox ${run} Zelle to recipient`,
    outside: `Beanbag Sandbox ${run} Unselected savings`,
  };
  const text = (value: unknown, field: string) => {
    if (typeof value !== "string" || !value)
      throw new Error(`Sandbox response is missing ${field}`);
    return value;
  };

  beforeAll(async () => {
    if (
      process.env.PLAID_ENV !== "sandbox" ||
      !process.env.PLAID_SANDBOX_CLIENT_ID ||
      !process.env.PLAID_SANDBOX_SECRET
    ) {
      throw new Error(
        "Run this suite through npm run test:sandbox with separate Sandbox credentials.",
      );
    }
    api = new PlaidClient(
      process.env.PLAID_SANDBOX_CLIENT_ID,
      process.env.PLAID_SANDBOX_SECRET,
      "sandbox",
    );
    const security = { ticker_symbol: "MSFT", currency: "USD" };
    const household = {
      version: 2,
      seed: "beanbag-boundary-household-v1",
      override_accounts: [
        {
          type: "depository",
          subtype: "checking",
          currency: "USD",
          starting_balance: 10000,
          meta: { name: "Sandbox joint checking", mask: "0001" },
          transactions: [],
        },
        {
          type: "depository",
          subtype: "savings",
          currency: "USD",
          starting_balance: 1000,
          meta: { name: "Sandbox unselected savings", mask: "0003" },
          transactions: [],
        },
        {
          type: "investment",
          subtype: "brokerage",
          currency: "USD",
          meta: { name: "Sandbox joint brokerage", mask: "0002" },
          investment_transactions: [
            {
              date,
              name: `Beanbag Sandbox ${run} buy`,
              quantity: 10,
              price: 125,
              fees: 0,
              type: "buy",
              currency: "USD",
              security,
            },
            {
              date,
              name: `Beanbag Sandbox ${run} sell`,
              quantity: -2,
              price: 130,
              fees: 0,
              type: "sell",
              currency: "USD",
              security,
            },
            {
              date,
              name: `Beanbag Sandbox ${run} external share candidate`,
              quantity: 2.5,
              price: 0,
              fees: 0,
              type: "transfer",
              currency: "USD",
              security,
            },
          ],
          holdings: [
            {
              institution_price: 125,
              institution_price_as_of: date,
              cost_basis: 1000,
              quantity: 10.5,
              currency: "USD",
              security,
            },
          ],
        },
      ],
    };
    const publicToken = await api.post("/sandbox/public_token/create", {
      institution_id: "ins_109508",
      initial_products: ["transactions", "investments"],
      options: {
        override_username: "user_custom",
        override_password: JSON.stringify(household),
      },
    });
    const item = await api.post("/item/public_token/exchange", {
      public_token: text(publicToken.public_token, "public token"),
    });
    token = text(item.access_token, "access token");
    const available = await api.post("/accounts/get", {
      access_token: token,
    });
    if (!Array.isArray(available.accounts))
      throw new Error("Sandbox accounts response is invalid");
    const accounts = available.accounts as JsonRecord[];
    const checking = accounts.find(
      (a) => a.type === "depository" && a.subtype === "checking",
    );
    const brokerage = accounts.find(
      (a) => a.type === "investment" && a.subtype === "brokerage",
    );
    const savings = accounts.find(
      (a) => a.type === "depository" && a.subtype === "savings",
    );
    if (!checking || !brokerage || !savings)
      throw new Error(
        "Custom Sandbox household is missing a configured checking, brokerage or savings account",
      );
    selected = selectAccounts(
      accounts,
      [checking.account_id, brokerage.account_id],
      checking.mask,
      brokerage.mask,
    );
    database = sqliteD1();
    repo = new D1Ledger(database.db);
    for (const account of selected) {
      await database.db
        .prepare("INSERT INTO accounts(id,role,label,mask) VALUES(?,?,?,?)")
        .bind(account.id, account.role, account.label, account.mask)
        .run();
    }
    await api.post("/sandbox/transactions/create", {
      access_token: token,
      transactions: [
        {
          description: descriptions.income,
          amount: -4321.09,
          account_id: checking.account_id,
        },
        {
          description: descriptions.card,
          amount: 198.76,
          account_id: checking.account_id,
        },
        {
          description: descriptions.internal,
          amount: 1000.25,
          account_id: checking.account_id,
        },
        {
          description: descriptions.zelle,
          amount: 7.3,
          account_id: checking.account_id,
        },
        {
          description: descriptions.outside,
          amount: -9999.99,
          account_id: savings.account_id,
        },
      ].map((transaction) => ({
        ...transaction,
        date_transacted: date,
        date_posted: date,
        iso_currency_code: "USD",
      })),
    });
  });

  afterAll(async () => {
    try {
      if (token) await api.post("/item/remove", { access_token: token });
    } finally {
      token = undefined;
      database?.sqlite.close();
    }
  });

  it("ingests only selected checking and applies the boundary to provider-created transactions", async () => {
    const sync = new SyncService(api, repo, token!);
    let seeded = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sync.checking();
      seeded = (await repo.events()).filter((e) =>
        e.description.includes(run),
      ).length;
      if (seeded >= 4) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(seeded).toBe(4);
    const records = (await repo.events()).filter((e) =>
      e.description.includes(run),
    );
    expect(records.some((e) => e.description === descriptions.outside)).toBe(
      false,
    );
    const totals = report(records, { start: date, end: date }).totals;
    expect(totals).toMatchObject({
      cashIncome: 432109,
      spending: 20606,
      internalTransfers: 100025,
      stockIncome: 0,
      netCashFlow: 411503,
    });
    expect(Boolean(await repo.cursor("checking"))).toBe(true);
    expect(
      (await repo.sources()).every((s) => s.accountId === selected[0].id),
    ).toBe(true);
  });

  it("reruns cursor sync without duplicating seeded events or losing a reviewed decision", async () => {
    const source = (await repo.sources()).find(
      (s) => s.description === descriptions.card,
    );
    if (!source) throw new Error("Seeded card source was not ingested");
    const event = (await repo.events()).find((e) => e.sourceId === source.id)!;
    await repo.saveOverride({
      id: crypto.randomUUID(),
      eventId: event.id,
      baseRevision: source.revision,
      kind: "ignored",
      rationale:
        "Synthetic Sandbox review override for persistence verification",
      actor: "sandbox-reviewer",
      createdAt: new Date().toISOString(),
    });
    await new SyncService(api, repo, token!).checking();
    const records = (await repo.events()).filter((e) =>
      e.description.includes(run),
    );
    expect(records.length).toBe(4);
    expect(records.find((e) => e.description === descriptions.card)?.kind).toBe(
      "ignored",
    );
    expect((await repo.overrides()).length).toBe(1);
    expect(report(records, { start: date, end: date }).totals.spending).toBe(
      730,
    );
  });

  it("requires review of a provider share receipt and freezes its approved historical valuation", async () => {
    await new SyncService(api, repo, token!).investments();
    const sources = (await repo.sources()).filter(
      (s) => s.kind === "investment",
    );
    expect(sources.length > 0).toBe(true);
    expect(sources.every((s) => s.accountId === selected[1].id)).toBe(true);
    expect(
      (await repo.events()).some(
        (e) => e.kind === "stock_income" && e.status === "confirmed",
      ),
    ).toBe(false);
    const receipt = sources.find(
      (s) => s.kind === "investment" && s.activity === "transfer",
    );
    if (!receipt || receipt.kind !== "investment")
      throw new Error("Custom Sandbox share receipt was not returned");
    expect(receipt.quantity).toBe("2.5");
    expect(
      (await repo.events()).find((e) => e.sourceId === receipt.id)?.status,
    ).toBe("needs_review");
    if (!receipt.securityId || !receipt.quantity)
      throw new Error("Sandbox receipt identity or quantity is missing");
    const receiptEvent = (await repo.events()).find(
      (e) => e.sourceId === receipt.id,
    )!;
    await repo.saveOverride({
      id: crypto.randomUUID(),
      eventId: receiptEvent.id,
      baseRevision: receipt.revision,
      kind: "stock_income",
      rationale:
        "Synthetic external receipt and historical quote from the explicit Sandbox fixture",
      actor: "sandbox-reviewer",
      createdAt: new Date().toISOString(),
      valuation: {
        securityId: receipt.securityId,
        quantity: receipt.quantity,
        eventDate: receipt.date,
        close: "150.12",
        priceDate: receipt.date,
        currency: "USD",
        provider: "Synthetic Sandbox historical quote",
        retrievedAt: new Date().toISOString(),
        convention: "last_session_close",
      },
    });
    await new SyncService(api, repo, token!).investments();
    const confirmedReceipts = (await repo.events()).filter(
      (e) => e.kind === "stock_income" && e.status === "confirmed",
    );
    expect(confirmedReceipts.length).toBe(1);
    expect(confirmedReceipts[0].amountCents).toBe(37530);
    expect(confirmedReceipts[0].valuation?.close).toBe("150.12");
    expect(
      (await repo.events()).filter(
        (e) => e.sourceType === "investment" && e.kind === "ignored",
      ).length,
    ).toBe(2);
    expect(
      (await repo.coverage()).find((h) => h.product === "investments")
        ?.completeThrough,
    ).toBeNull();
  });

  it("surfaces an actual provider login error without advancing the durable checking cursor", async () => {
    const cursor = await repo.cursor("checking");
    await api.post("/sandbox/item/reset_login", { access_token: token });
    let errorCode: string | undefined;
    try {
      await new SyncService(api, repo, token!).checking();
    } catch (error) {
      if (error instanceof ProviderError) errorCode = error.code;
      else throw error;
    }
    expect(errorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect((await repo.cursor("checking")) === cursor).toBe(true);
    expect(
      (await repo.coverage()).find((h) => h.product === "checking")?.error,
    ).toBe("ITEM_LOGIN_REQUIRED");
  });
});
