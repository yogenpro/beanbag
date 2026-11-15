import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { D1Ledger } from "../src/data/d1";
import { defaultCoverage } from "../src/data/repository";
import { sqliteD1 } from "./sqlite-d1";
import { accounts, bank, investment, override, valuation } from "./fixtures";
import type { Source } from "../src/accounting/types";

describe("D1-compatible SQLite persistence", () => {
  let database: ReturnType<typeof sqliteD1>, repo: D1Ledger;
  beforeEach(async () => {
    database = sqliteD1();
    repo = new D1Ledger(database.db);
    for (const a of accounts)
      await database.db
        .prepare("INSERT INTO accounts(id,role,label,mask) VALUES(?,?,?,?)")
        .bind(a.id, a.role, a.label, a.mask)
        .run();
  });
  afterEach(() => database.sqlite.close());
  async function commit(
    sources: Source[] = [bank()],
    removed: string[] = [],
    cursor = "durable-cursor",
  ) {
    const now = new Date().toISOString(),
      leaseId = (await repo.acquire("checking", now))!;
    await repo.commitSync({
      product: "checking",
      leaseId,
      writes: sources.map((record) => ({
        record,
        raw: '{"synthetic":"original-evidence"}',
      })),
      removed,
      cursor,
      coverage: {
        ...defaultCoverage("checking"),
        lastAttempt: now,
        lastSuccess: now,
      },
    });
  }
  function trackWrites() {
    database.sqlite.exec(`
      CREATE TEMP TABLE observed_writes(table_name TEXT, id TEXT);
      CREATE TEMP TRIGGER observe_events_insert AFTER INSERT ON financial_events
        BEGIN INSERT INTO observed_writes VALUES ('events', NEW.id); END;
      CREATE TEMP TRIGGER observe_events_update AFTER UPDATE ON financial_events
        BEGIN INSERT INTO observed_writes VALUES ('events', NEW.id); END;
      CREATE TEMP TRIGGER observe_sources_update AFTER UPDATE ON source_records
        BEGIN INSERT INTO observed_writes VALUES ('sources', NEW.id); END;
    `);
    return () =>
      database.sqlite
        .prepare(
          "SELECT table_name,id FROM observed_writes ORDER BY table_name,id",
        )
        .all();
  }
  it("does not rewrite unchanged sources or events, while advancing sync health and cursor", async () => {
    await commit([bank(), bank({ id: "another" })]);
    const writes = trackWrites();
    await commit([bank(), bank({ id: "another" })], [], "next-cursor");
    await commit([], [], "empty-page-cursor");
    expect(writes()).toEqual([]);
    expect(await repo.cursor("checking")).toBe("empty-page-cursor");
    expect((await repo.coverage())[0].lastSuccess).toBeTruthy();
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM sync_runs WHERE status='success'",
        )
        .get()?.count,
    ).toBe(3);
  });
  it("writes only the corrected event, including changes that leave its amount unchanged", async () => {
    await commit([bank(), bank({ id: "unrelated" })]);
    const writes = trackWrites();
    await commit([bank({ description: "Corrected payroll", revision: "v2" })]);
    expect(writes()).toEqual([
      { table_name: "events", id: "bank:bank-1" },
      { table_name: "sources", id: "bank:bank-1" },
    ]);
    expect(
      JSON.parse(
        String(
          database.sqlite
            .prepare(
              "SELECT event_json FROM financial_events WHERE id='bank:bank-1'",
            )
            .get()?.event_json,
        ),
      ).description,
    ).toBe("Corrected payroll");
  });
  it("updates an existing counterpart when a new transfer leg changes its classification", async () => {
    await commit([
      bank({ amountCents: -25000, description: "ACH transfer" }),
      bank({ id: "unrelated" }),
    ]);
    const writes = trackWrites();
    await commit([
      investment({
        ticker: "CUR:USD",
        securityType: "cash",
        quantity: "0",
        cashAmountCents: 25000,
        origin: "unknown",
        direction: "unknown",
      }),
    ]);
    expect(writes().filter((w) => w.table_name === "events")).toEqual([
      { table_name: "events", id: "bank:bank-1" },
      { table_name: "events", id: "investment:stock-1" },
    ]);
    expect(
      database.sqlite
        .prepare("SELECT kind FROM financial_events WHERE id='bank:bank-1'")
        .get()?.kind,
    ).toBe("internal_transfer");
  });
  it("repairs missing or stale cached events even when the provider has no changes", async () => {
    await commit([bank(), bank({ id: "missing" }), bank({ id: "unrelated" })]);
    database.sqlite.exec(`
      UPDATE financial_events SET amount_cents=NULL WHERE id='bank:bank-1';
      DELETE FROM financial_events WHERE id='bank:missing';
    `);
    const writes = trackWrites();
    await commit([]);
    expect(writes()).toEqual([
      { table_name: "events", id: "bank:bank-1" },
      { table_name: "events", id: "bank:missing" },
    ]);
    expect(
      database.sqlite
        .prepare(
          "SELECT amount_cents FROM financial_events WHERE id='bank:bank-1'",
        )
        .get()?.amount_cents,
    ).toBe(400000);
    database.sqlite.exec("DELETE FROM observed_writes");
    await commit([]);
    expect(writes()).toEqual([]);
  });
  it("atomically stores source evidence, events and cursor, and upserts idempotently", async () => {
    await commit();
    await commit();
    expect(await repo.sources()).toHaveLength(1);
    expect(await repo.events()).toHaveLength(1);
    expect(await repo.cursor("checking")).toBe("durable-cursor");
    const reloaded = new D1Ledger(database.db);
    expect((await reloaded.events())[0].amountCents).toBe(400000);
    expect(
      database.sqlite.prepare("SELECT raw_json FROM source_records").get()
        ?.raw_json,
    ).toContain("original-evidence");
  });
  it("rolls back the entire batch if one source violates the account boundary FK", async () => {
    await expect(
      commit([bank(), bank({ id: "bad", accountId: "unselected" })]),
    ).rejects.toThrow();
    expect(await repo.cursor("checking")).toBeNull();
    expect(await repo.sources()).toHaveLength(0);
    expect(await repo.events()).toHaveLength(0);
  });
  it("preserves overrides and original evidence through refresh and removal", async () => {
    await commit();
    await repo.saveOverride(override({ kind: "ignored" }));
    await commit();
    expect((await repo.events())[0].kind).toBe("ignored");
    expect(await repo.overrides()).toHaveLength(1);
    await commit([bank({ amountCents: 410000, revision: "v2" })]);
    expect((await repo.events())[0].status).toBe("needs_review");
    await commit([], ["bank:bank-1"]);
    expect((await repo.events())[0].status).toBe("removed");
    expect(await repo.overrides()).toHaveLength(1);
    expect(
      database.sqlite.prepare("SELECT raw_json FROM source_records").get()
        ?.raw_json,
    ).toContain("original-evidence");
  });
  it("rejects stale reviews and retains reviewer audit history", async () => {
    await commit();
    await expect(
      repo.saveOverride(override({ baseRevision: "outdated" })),
    ).rejects.toThrow("changed");
    await repo.saveOverride(override({ kind: "spending" }));
    await repo.saveOverride(
      override({
        id: "review-2",
        kind: "cash_income",
        actor: "second-reviewer",
      }),
    );
    expect((await repo.events())[0].kind).toBe("cash_income");
    expect((await repo.overrides()).map((o) => o.actor)).toEqual([
      "test-reviewer",
      "second-reviewer",
    ]);
  });
  it("deduplicates reviewed manual receipts and freezes their historical value", async () => {
    const source = investment({ id: "manual:stable-ref", manual: true });
    const decision = override({
      eventId: "investment:manual:stable-ref",
      kind: "stock_income",
      valuation: valuation(),
    });
    await repo.saveManual(
      { record: source, raw: '{"synthetic":"receipt"}' },
      decision,
    );
    await expect(
      repo.saveManual({ record: source, raw: "{}" }, decision),
    ).rejects.toThrow("exists");
    const loaded = new D1Ledger(database.db);
    expect((await loaded.events())[0]).toMatchObject({
      kind: "stock_income",
      amountCents: 2000000,
      valuation: { close: "200", priceDate: "2026-08-10" },
    });
  });
  it("a replaced lease cannot publish changes or an advanced cursor", async () => {
    const now = new Date().toISOString(),
      lease = (await repo.acquire("checking", now))!;
    await database.db
      .prepare(
        "UPDATE sync_state SET lease_id='new-owner' WHERE product='checking'",
      )
      .run();
    await expect(
      repo.commitSync({
        product: "checking",
        leaseId: lease,
        writes: [{ record: bank(), raw: "{}" }],
        removed: [],
        cursor: "unsafe",
        coverage: {
          ...defaultCoverage("checking"),
          lastAttempt: now,
          lastSuccess: now,
        },
      }),
    ).rejects.toThrow("lease");
    expect(await repo.sources()).toHaveLength(0);
    expect(await repo.cursor("checking")).toBeNull();
  });
  it("compare-and-swap aborts a sync that races a newer ledger write", async () => {
    await commit();
    const originalBatch = database.db.batch.bind(database.db);
    let race = true;
    database.db.batch = (async (statements) => {
      if (race) {
        race = false;
        database.sqlite
          .prepare("UPDATE ledger_meta SET revision=revision+1 WHERE id=1")
          .run();
      }
      return originalBatch(statements);
    }) as D1Database["batch"];
    await expect(
      commit(
        [bank({ amountCents: 99999, revision: "v2" })],
        [],
        "unsafe-cursor",
      ),
    ).rejects.toThrow();
    expect((await repo.events())[0].amountCents).toBe(400000);
    expect(await repo.cursor("checking")).toBe("durable-cursor");
  });
});
