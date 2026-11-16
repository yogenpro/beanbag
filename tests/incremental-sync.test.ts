import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { D1Ledger } from "../src/data/d1";
import { defaultCoverage, type SyncCommit } from "../src/data/repository";
import { eventId, type Source } from "../src/accounting/types";
import { SyncService } from "../src/providers/plaid/sync";
import type { JsonRecord, PlaidApi } from "../src/providers/plaid/client";
import { accounts, bank, investment } from "./fixtures";
import { sqliteD1 } from "./sqlite-d1";

// Observe real SQL results and query plans, rather than mocking repository data.
function observe(database: ReturnType<typeof sqliteD1>) {
  const reads: { sql: string; rows: number; plan: string[] }[] = [];
  const prepare = database.db.prepare.bind(database.db);
  database.db.prepare = ((sql: string) => {
    function wrap(
      statement: D1PreparedStatement,
      values: unknown[] = [],
    ): D1PreparedStatement {
      const bind = statement.bind.bind(statement),
        all = statement.all.bind(statement);
      statement.bind = (...args) => wrap(bind(...args), args);
      statement.all = (async () => {
        const result = await all();
        reads.push({
          sql,
          rows: result.results.length,
          plan: database.sqlite
            .prepare("EXPLAIN QUERY PLAN " + sql)
            .all(...(values as never[]))
            .map((r) => String(r.detail)),
        });
        return result;
      }) as D1PreparedStatement["all"];
      return statement;
    }
    return wrap(prepare(sql));
  }) as D1Database["prepare"];
  return reads;
}

describe("incremental sync reads and dependency updates", () => {
  let database: ReturnType<typeof sqliteD1>, repo: D1Ledger;
  beforeEach(() => {
    database = sqliteD1();
    repo = new D1Ledger(database.db);
    for (const a of accounts)
      database.sqlite
        .prepare("INSERT INTO accounts VALUES(?,?,?,?)")
        .run(a.id, a.role, a.label, a.mask);
  });
  afterEach(() => database.sqlite.close());
  async function commit(sources: Source[], patch: Partial<SyncCommit> = {}) {
    const product = patch.product ?? "checking",
      now = new Date().toISOString();
    await repo.commitSync({
      product,
      leaseId: (await repo.acquire(product, now))!,
      writes: sources.map((record) => ({ record, raw: "{}" })),
      removed: [],
      cursor: "next",
      coverage: {
        ...defaultCoverage(product),
        lastAttempt: now,
        lastSuccess: now,
      },
      ...patch,
    });
  }
  function seedHistory(count: number) {
    const statement = database.sqlite.prepare(
      "INSERT INTO source_records(id,source_kind,provider_id,account_id,event_date,revision,record_json,raw_json,removed) VALUES(?,?,?,?,?,?,?,?,0)",
    );
    database.sqlite.exec("BEGIN");
    for (let i = 0; i < count; i++) {
      const record = bank({ id: `old-${i}`, date: "2014-01-01" });
      statement.run(
        eventId(record),
        record.kind,
        record.id,
        record.accountId,
        record.date,
        record.revision,
        JSON.stringify(record),
        "{}",
      );
    }
    database.sqlite.exec("COMMIT");
  }
  function expectIndexed(reads: ReturnType<typeof observe>) {
    const sourceReads = reads.filter((r) =>
      /FROM source_records|JOIN source_records/.test(r.sql),
    );
    for (const r of sourceReads) {
      expect(
        r.plan.some((p) => /SEARCH (source_records|s) USING INDEX/.test(p)),
        r.sql,
      ).toBe(true);
      expect(
        r.plan.some((p) => /SCAN (source_records|s)\b/.test(p)),
        r.sql,
      ).toBe(false);
    }
  }
  async function expectCurrentCache() {
    const expected = await repo.events();
    const cached = database.sqlite
      .prepare("SELECT id,event_json FROM financial_events")
      .all();
    for (const row of cached)
      expect(JSON.parse(String(row.event_json))).toEqual(
        expected.find((e) => e.id === row.id),
      );
  }
  it("reads no historical sources or events on an idle checking poll, regardless of history size", async () => {
    seedHistory(6000);
    const reads = observe(database);
    const provider: PlaidApi = {
      post: async <T extends JsonRecord>() =>
        ({
          added: [],
          modified: [],
          removed: [],
          has_more: false,
          next_cursor: "empty",
        }) as unknown as T,
    };
    await new SyncService(provider, repo, "invented-token").checking();
    expect(
      reads.some((r) => /source_records|financial_events/.test(r.sql)),
    ).toBe(false);
    expect(await repo.cursor("checking")).toBe("empty");
  });
  it("compares only the brokerage window and IDs when nothing changed", async () => {
    await commit([investment({ date: "2026-08-14" })], {
      product: "investments",
    });
    seedHistory(6000);
    const reads = observe(database);
    await commit([investment({ date: "2026-08-14" })], {
      product: "investments",
      reconcileWindow: {
        start: "2026-08-08",
        end: "2026-08-15",
        presentIds: ["investment:stock-1"],
      },
    });
    expect(
      reads
        .filter((r) => /source_records/.test(r.sql))
        .reduce((n, r) => n + r.rows, 0),
    ).toBe(1);
    expect(
      reads.some((r) =>
        /financial_events|historical_prices|event_overrides/.test(r.sql),
      ),
    ).toBe(false);
    expectIndexed(reads);
  });
  it("reclassifies a correction with bounded reads and leaves remote years untouched", async () => {
    await commit([bank(), bank({ id: "nearby", date: "2026-08-12" })]);
    seedHistory(6000);
    const reads = observe(database);
    await commit([bank({ amountCents: 410000, revision: "v2" })]);
    expect(
      reads
        .filter((r) => /source_records|financial_events/.test(r.sql))
        .reduce((n, r) => n + r.rows, 0),
    ).toBeLessThan(12);
    expectIndexed(reads);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS n FROM financial_events")
        .get()?.n,
    ).toBe(2);
    await expectCurrentCache();
  });
  it("tracks both old and new neighborhoods when a transfer's date changes", async () => {
    const cash = investment({
      id: "cash",
      ticker: "CUR:USD",
      securityType: "cash",
      quantity: "0",
      cashAmountCents: 25000,
      origin: "unknown",
      direction: "unknown",
    });
    await commit([
      bank({ description: "ACH transfer", amountCents: -25000 }),
      cash,
    ]);
    await commit([{ ...cash, date: "2026-09-10", revision: "v2" }]);
    await expectCurrentCache();
    expect(
      database.sqlite
        .prepare("SELECT kind FROM financial_events WHERE id='bank:bank-1'")
        .get()?.kind,
    ).toBe("spending");
  });
  it("updates the two-hop counterpart when another possible leg appears or disappears", async () => {
    const outgoing = bank({
      id: "out",
      date: "2026-08-04",
      description: "ACH transfer",
      amountCents: -25000,
    });
    const incoming = investment({
      id: "in",
      date: "2026-08-07",
      ticker: "CUR:USD",
      securityType: "cash",
      quantity: "0",
      cashAmountCents: 25000,
      origin: "unknown",
      direction: "unknown",
    });
    await commit([outgoing, incoming]);
    await commit([
      bank({
        id: "competitor",
        date: "2026-08-10",
        description: "ACH transfer",
        amountCents: -25000,
      }),
    ]);
    await expectCurrentCache();
    expect(
      database.sqlite
        .prepare("SELECT kind FROM financial_events WHERE id='bank:out'")
        .get()?.kind,
    ).toBe("spending");
    await commit([], { removed: ["bank:competitor"] });
    await expectCurrentCache();
    expect(
      database.sqlite
        .prepare("SELECT kind FROM financial_events WHERE id='bank:out'")
        .get()?.kind,
    ).toBe("internal_transfer");
  });
  it("uses context outside the publish neighborhood to avoid inventing reciprocal matches", async () => {
    const outgoing = (id: string, date: string) =>
      bank({ id, date, description: "ACH transfer", amountCents: -25000 });
    const incoming = (id: string, date: string) =>
      investment({
        id,
        date,
        ticker: "CUR:USD",
        securityType: "cash",
        quantity: "0",
        cashAmountCents: 25000,
        origin: "unknown",
        direction: "unknown",
      });
    await commit([
      outgoing("far-out", "2026-08-16"),
      incoming("far-in", "2026-08-13"),
      outgoing("middle", "2026-08-10"),
    ]);
    await commit([bank({ id: "trigger", date: "2026-08-04" })]);
    await expectCurrentCache();
    expect(
      database.sqlite
        .prepare("SELECT kind FROM financial_events WHERE id='bank:middle'")
        .get()?.kind,
    ).toBe("spending");
  });
  it("keeps native/manual evidence while tombstoning absent provider rows in a window", async () => {
    const sources = [
      investment({ id: "schwab:native" }),
      investment({ id: "manual", manual: true }),
      investment({ id: "provider" }),
    ];
    await commit(sources, { product: "investments" });
    await commit([], {
      product: "investments",
      reconcileWindow: {
        start: "2026-08-01",
        end: "2026-08-15",
        presentIds: [],
      },
    });
    expect(
      (await repo.sources()).filter((s) => s.removed).map((s) => s.id),
    ).toEqual(["provider"]);
    await expectCurrentCache();
  });
  it("handles a newly added record that is removed in the same batch", async () => {
    await commit([bank()], { removed: ["bank:bank-1"] });
    expect((await repo.sources())[0].removed).toBe(true);
    expect((await repo.events())[0].status).toBe("removed");
  });
  it("keeps new raw evidence without reclassifying an unchanged normalized record", async () => {
    await commit([bank()]);
    const reads = observe(database);
    await commit([bank()], {
      writes: [{ record: bank(), raw: '{"provider_metadata":"updated"}' }],
    });
    expect(
      reads.some((r) =>
        /financial_events|historical_prices|event_overrides/.test(r.sql),
      ),
    ).toBe(false);
    expect(
      database.sqlite.prepare("SELECT raw_json FROM source_records").get()
        ?.raw_json,
    ).toContain("updated");
  });
  it("updates duplicate share receipts and clears the surviving conflict after removal", async () => {
    const shares = investment({ unitPrice: "200" });
    await commit([shares]);
    await commit([{ ...shares, id: "duplicate" }]);
    await expectCurrentCache();
    expect(
      (await repo.events()).every((e) => e.status === "needs_review"),
    ).toBe(true);
    await commit([], { removed: ["investment:duplicate"] });
    await expectCurrentCache();
    expect(
      (await repo.events()).find((e) => e.sourceId === shares.id)?.status,
    ).toBe("confirmed");
  });
  it("recomputes the latest posted date after removal and excludes pending entries", async () => {
    await commit([
      bank({ id: "first", date: "2026-08-01" }),
      bank({ id: "last", date: "2026-08-10" }),
      bank({ id: "pending", date: "2026-08-14", pending: true }),
    ]);
    expect((await repo.coverage())[0].mostRecentDate).toBe("2026-08-10");
    await commit([], { removed: ["bank:last"] });
    expect((await repo.coverage())[0].mostRecentDate).toBe("2026-08-01");
  });
  it("refuses an explicit cache rebuild during a sync lease", async () => {
    await repo.acquire("checking", new Date().toISOString());
    await expect(repo.rebuildEventCache()).rejects.toThrow();
    expect(
      database.sqlite.prepare("SELECT revision FROM ledger_meta").get()
        ?.revision,
    ).toBe(0);
  });
});
