import { describe, expect, it } from "vitest";
import { MemoryLedger } from "../src/data/memory";
import {
  ProviderError,
  PlaidClient,
  type JsonRecord,
  type PlaidApi,
} from "../src/providers/plaid/client";
import { SyncService } from "../src/providers/plaid/sync";
import {
  normalizeBank,
  normalizeInvestment,
} from "../src/providers/plaid/normalize";
import {
  accounts,
  investment,
  override,
  rawBank,
  rawInvestment,
} from "./fixtures";

class FakePlaid implements PlaidApi {
  calls: { path: string; body: JsonRecord }[] = [];
  constructor(private readonly responses: (JsonRecord | Error)[]) {}
  async post<T extends JsonRecord = JsonRecord>(
    path: string,
    body: JsonRecord,
  ): Promise<T> {
    this.calls.push({ path, body });
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Unexpected provider request");
    return response as T;
  }
}
const page = (patch: JsonRecord = {}): JsonRecord => ({
  added: [],
  modified: [],
  removed: [],
  next_cursor: "cursor-final",
  has_more: false,
  ...patch,
});
const investmentPage = (records: JsonRecord[], total = records.length) => ({
  investment_transactions: records,
  total_investment_transactions: total,
  securities: [{ security_id: "test-xyz", ticker_symbol: "XYZ" }],
});
const now = () => new Date("2026-08-15T12:00:00Z");

describe("checking cursor synchronization", () => {
  it("applies added/modified/removed and pending replacement idempotently", async () => {
    const repo = new MemoryLedger(accounts);
    const provider = new FakePlaid([
      page({
        added: [
          rawBank({ transaction_id: "pending-1", pending: true }),
          rawBank({
            account_id: "unselected",
            transaction_id: "private-other-account",
          }),
        ],
      }),
      page({
        added: [rawBank({ pending_transaction_id: "pending-1" })],
        removed: [{ transaction_id: "pending-1" }],
      }),
      page({
        modified: [rawBank({ amount: "-4200" })],
        next_cursor: "modified-cursor",
      }),
      page({
        modified: [rawBank({ amount: "-4200" })],
        next_cursor: "modified-cursor",
      }),
      page({ removed: [{ transaction_id: "provider-bank-1" }] }),
    ]);
    const sync = new SyncService(provider, repo, "synthetic-token", now);
    await sync.checking();
    expect(
      (await repo.events()).filter((e) => e.status === "pending"),
    ).toHaveLength(1);
    expect(provider.calls[0].body.options.account_id).toBe(accounts[0].id);
    await sync.checking();
    expect(
      (await repo.events()).filter((e) => e.status === "confirmed"),
    ).toHaveLength(1);
    expect(
      (await repo.sources()).some((s) => s.accountId === "unselected"),
    ).toBe(false);
    const posted = (await repo.sources()).find(
      (s) => s.id === "provider-bank-1",
    )!;
    await repo.saveOverride(
      override({
        eventId: "bank:provider-bank-1",
        baseRevision: posted.revision,
        kind: "ignored",
      }),
    );
    await sync.checking();
    expect(
      (await repo.events()).find((e) => e.sourceId === "provider-bank-1")
        ?.status,
    ).toBe("needs_review");
    expect(await repo.overrides()).toHaveLength(1);
    await sync.checking();
    expect(
      (await repo.sources()).filter((s) => s.id === "provider-bank-1"),
    ).toHaveLength(1);
    expect(await repo.cursor("checking")).toBe("modified-cursor");
    await sync.checking();
    expect(
      (await repo.events()).find((e) => e.sourceId === "provider-bank-1")
        ?.status,
    ).toBe("removed");
    expect((await repo.coverage())[0].mostRecentDate).toBeNull();
    expect((await repo.coverage())[0].limitation).not.toContain(
      "Not connected",
    );
  });
  it("does not publish first-page data or advance cursor when a later page fails", async () => {
    const repo = new MemoryLedger(accounts);
    repo.cursors.set("checking", "durable-start");
    const provider = new FakePlaid([
      page({ added: [rawBank()], next_cursor: "partial", has_more: true }),
      new ProviderError("ITEM_LOGIN_REQUIRED"),
    ]);
    await expect(
      new SyncService(provider, repo, "synthetic-token", now).checking(),
    ).rejects.toThrow("ITEM_LOGIN_REQUIRED");
    expect(await repo.cursor("checking")).toBe("durable-start");
    expect(await repo.sources()).toHaveLength(0);
    expect((await repo.coverage())[0].error).toBe("ITEM_LOGIN_REQUIRED");
  });
  it("restarts all pagination after mutation and discards staged stale pages", async () => {
    const repo = new MemoryLedger(accounts);
    repo.cursors.set("checking", "original");
    const provider = new FakePlaid([
      page({
        added: [rawBank({ transaction_id: "discarded" })],
        has_more: true,
        next_cursor: "partial",
      }),
      new ProviderError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"),
      page({ added: [rawBank()] }),
    ]);
    await new SyncService(provider, repo, "synthetic-token", now).checking();
    expect(provider.calls[2].body.cursor).toBe("original");
    expect((await repo.sources()).map((s) => s.id)).toEqual([
      "provider-bank-1",
    ]);
  });
  it("serializes duplicate triggers with a per-product lease", async () => {
    const repo = new MemoryLedger(accounts);
    await repo.acquire("checking");
    const provider = new FakePlaid([]);
    expect(
      await new SyncService(provider, repo, "synthetic-token", now).checking(),
    ).toBe("busy");
    expect(provider.calls).toHaveLength(0);
  });
});
describe("investment polling and coverage", () => {
  it("uses a bounded allowlisted window, preserves manual receipts, and reconciles disappearance", async () => {
    const manual = investment({ id: "manual:verified", manual: true });
    const repo = new MemoryLedger(accounts, [manual]);
    const provider = new FakePlaid([
      investmentPage([rawInvestment()]),
      investmentPage([]),
    ]);
    const sync = new SyncService(provider, repo, "synthetic-token", now);
    await sync.investments("2026-08-01", "2026-08-15");
    expect(provider.calls[0].body.options.account_ids).toEqual([
      accounts[1].id,
    ]);
    expect(
      (await repo.events()).find((e) => e.sourceId === "provider-investment-1")
        ?.status,
    ).toBe("needs_review");
    await sync.investments("2026-08-01", "2026-08-15");
    expect(
      (await repo.events()).find((e) => e.sourceId === "provider-investment-1")
        ?.status,
    ).toBe("removed");
    expect(
      (await repo.sources()).find((s) => s.id === manual.id)?.removed,
    ).not.toBe(true);
    expect((await repo.coverage())[1]).toMatchObject({
      completeThrough: null,
      error: null,
      startDate: "2026-08-01",
    });
  });
  it("does not remove old sources after incomplete or changing pagination", async () => {
    const old = investment({ id: "old-provider-source" }),
      repo = new MemoryLedger(accounts, [old]);
    const records = Array.from({ length: 100 }, (_, i) =>
      rawInvestment({ investment_transaction_id: `first-${i}` }),
    );
    const provider = new FakePlaid([
      investmentPage(records, 101),
      investmentPage([rawInvestment()], 102),
    ]);
    await expect(
      new SyncService(provider, repo, "synthetic-token", now).investments(
        "2026-08-01",
        "2026-08-15",
      ),
    ).rejects.toThrow("INVESTMENT_PAGINATION_CHANGED");
    expect(await repo.sources()).toEqual([old]);
  });
  it("cancels the original investment record instead of counting the reversing entry", async () => {
    const repo = new MemoryLedger(accounts, [investment({ id: "original" })]);
    const provider = new FakePlaid([
      investmentPage([
        rawInvestment({
          cancel_transaction_id: "original",
          investment_transaction_id: "reversal",
        }),
      ]),
    ]);
    await new SyncService(provider, repo, "synthetic-token", now).investments(
      "2026-08-01",
      "2026-08-15",
    );
    const events = await repo.events();
    expect(events.find((e) => e.sourceId === "original")?.status).toBe(
      "removed",
    );
    expect(events.find((e) => e.sourceId === "reversal")?.kind).toBe("ignored");
  });
});
describe("provider normalization and secret-safe errors", () => {
  it("converts Plaid cash signs once and keeps exact numeric share precision from JSON", async () => {
    const client = new PlaidClient(
      "synthetic-id",
      "synthetic-secret",
      "sandbox",
      async () =>
        new Response(
          '{"investment_transactions":[{"quantity":0.123456789012345678901234}],"amount":-4000.01}',
        ),
    );
    const response = await client.post("/investments/transactions/get", {});
    const record = await normalizeInvestment(
      rawInvestment({ quantity: response.investment_transactions[0].quantity }),
      [],
    );
    expect(record.record.quantity).toBe("0.123456789012345678901234");
    const checking = await normalizeBank(rawBank({ amount: response.amount }));
    expect(checking.record.amountCents).toBe(400001);
    expect(record.record.origin).toBe("unknown");
    expect(record.record.direction).toBe("unknown");
  });
  it("never includes provider response, access token or secret in a thrown error", async () => {
    const client = new PlaidClient(
      "synthetic-id",
      "synthetic-secret",
      "sandbox",
      async () =>
        new Response(
          '{"error_code":"ITEM_LOGIN_REQUIRED","error_message":"sensitive-provider-payload"}',
          { status: 400 },
        ),
    );
    await expect(
      client.post("/accounts/get", { access_token: "sensitive-token" }),
    ).rejects.toThrow(/^ITEM_LOGIN_REQUIRED$/);
  });
});
