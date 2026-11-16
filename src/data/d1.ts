import { classify } from "../accounting/classify";
import { affectedSource, polledInvestment, sourceWindows } from "./sync-scope";
import {
  bankPaymentCategory,
  transferPricing,
} from "../providers/plaid/normalize";
import { validateHistory, type HistoricalValue } from "../accounting/history";
import {
  emptyBalanceHealth,
  type BalanceSnapshot,
  type BalanceHealth,
} from "../accounting/balances";
import {
  eventId,
  type Account,
  type Coverage,
  type FinancialEvent,
  type Override,
  type Source,
  type Valuation,
} from "../accounting/types";
import {
  defaultCoverage,
  reclassify,
  type LedgerRepository,
  type SourceWrite,
  type SyncCommit,
} from "./repository";

export class ConflictError extends Error {}
type SavedEvent = {
  id: string;
  event_date: string;
  kind: string;
  status: string;
  amount_cents: number | null;
  event_json: string;
};
type SavedSource = { id: string; record_json: string; raw_json: string };
export class D1Ledger implements LedgerRepository {
  constructor(readonly db: D1Database) {}
  accountValueHistory() {
    return this.jsonRows<HistoricalValue>(
      "SELECT value_json FROM (SELECT * FROM account_value_history UNION ALL SELECT * FROM account_value_reconstructions) ORDER BY as_of_date,account_id,method",
      "value_json",
    );
  }
  async saveAccountValueHistory(values: HistoricalValue[]) {
    validateHistory(values, await this.accounts());
    if (!values.length) return;
    const payload = JSON.stringify(values);
    if (new TextEncoder().encode(payload).length > 1500000)
      throw new Error("History batch exceeds byte limit");
    await this.db.batch(
      ["account_value_history", "account_value_reconstructions"].map((table) =>
        this.db
          .prepare(
            `INSERT INTO ${table}(account_id,as_of_date,method,value_json)
      SELECT json_extract(value,'$.accountId'),json_extract(value,'$.date'),json_extract(value,'$.method'),value
      FROM json_each(?) WHERE ${table === "account_value_reconstructions" ? "" : "NOT "}(json_extract(value,'$.method')='reconstructed')
      ON CONFLICT(account_id,as_of_date,method) DO UPDATE SET value_json=excluded.value_json
      WHERE json_extract(excluded.value_json,'$.calculatedAt') > json_extract(${table}.value_json,'$.calculatedAt')`,
          )
          .bind(payload),
      ),
    );
  }
  balanceSnapshots() {
    return this.jsonRows<BalanceSnapshot>(
      "SELECT snapshot_json FROM balance_snapshots ORDER BY captured_at",
      "snapshot_json",
    );
  }
  async balanceHealth(): Promise<BalanceHealth> {
    return (
      (
        await this.jsonRows<BalanceHealth>(
          "SELECT health_json FROM balance_refresh WHERE id=1",
          "health_json",
        )
      )[0] ?? emptyBalanceHealth()
    );
  }
  async saveBalanceSnapshot(snapshot: BalanceSnapshot) {
    const health: BalanceHealth = {
      lastAttempt: snapshot.capturedAt,
      lastSuccess: snapshot.capturedAt,
      error: null,
    };
    await this.db.batch([
      this.db
        .prepare(
          "INSERT OR IGNORE INTO balance_snapshots(captured_at,snapshot_json) VALUES(?,?)",
        )
        .bind(snapshot.capturedAt, JSON.stringify(snapshot)),
      this.db
        .prepare(
          `INSERT INTO balance_refresh(id,health_json) VALUES(1,?)
        ON CONFLICT(id) DO UPDATE SET health_json=excluded.health_json
        WHERE json_extract(excluded.health_json,'$.lastAttempt') >= json_extract(balance_refresh.health_json,'$.lastAttempt')`,
        )
        .bind(JSON.stringify(health)),
    ]);
  }
  async failBalanceRefresh(at: string, error: string) {
    await this.db
      .prepare(
        `INSERT INTO balance_refresh(id,health_json) VALUES(1,?)
      ON CONFLICT(id) DO UPDATE SET health_json=json_set(balance_refresh.health_json,'$.lastAttempt',?,'$.error',?)
      WHERE ? >= json_extract(balance_refresh.health_json,'$.lastAttempt')`,
      )
      .bind(
        JSON.stringify({ lastAttempt: at, lastSuccess: null, error }),
        at,
        error,
        at,
      )
      .run();
  }
  private async revision(): Promise<number> {
    return (await this.db
      .prepare("SELECT revision FROM ledger_meta WHERE id=1")
      .first<{ revision: number }>())!.revision;
  }
  private guard(revision: number): D1PreparedStatement[] {
    return [
      this.db
        .prepare(
          "UPDATE ledger_meta SET revision=revision+1 WHERE id=1 AND revision=?",
        )
        .bind(revision),
      // A failed compare-and-swap deliberately violates the singleton PK, rolling back.
      this.db.prepare(
        "INSERT INTO ledger_meta(id,revision) SELECT 1,0 WHERE changes()=0",
      ),
    ];
  }
  async accounts(): Promise<Account[]> {
    return (
      await this.db
        .prepare("SELECT id, role, label, mask FROM accounts")
        .all<Account>()
    ).results;
  }
  private async jsonRows<T>(
    sql: string,
    column: string,
    ...values: string[]
  ): Promise<T[]> {
    const result = await this.db
      .prepare(sql)
      .bind(...values)
      .all<Record<string, string>>();
    return result.results.map((r) => JSON.parse(r[column]) as T);
  }
  async sources(): Promise<Source[]> {
    const rows = await this.db
      .prepare("SELECT record_json, raw_json FROM source_records ORDER BY id")
      .all<{ record_json: string; raw_json: string }>();
    return rows.results.map((row) => this.sourceFromRow(row));
  }
  private sourceFromRow(
    row: Pick<SavedSource, "record_json" | "raw_json">,
  ): Source {
    return bankPaymentCategory(
      transferPricing(JSON.parse(row.record_json), row.raw_json),
      row.raw_json,
    );
  }

  private async sourceRows(
    ids: string[],
    window?: { start: string; end: string },
  ): Promise<SavedSource[]> {
    if (!ids.length && !window) return [];
    return (
      await this.db
        .prepare(
          `SELECT id,record_json,raw_json FROM source_records WHERE id IN (SELECT value FROM json_each(?))
      ${window ? "UNION SELECT id,record_json,raw_json FROM source_records INDEXED BY source_date WHERE event_date BETWEEN ? AND ? AND source_kind='investment'" : ""}`,
        )
        .bind(
          JSON.stringify(ids),
          ...(window ? [window.start, window.end] : []),
        )
        .all<SavedSource>()
    ).results;
  }

  private async savedEvents(ids?: string[]): Promise<SavedEvent[]> {
    if (ids && !ids.length) return [];
    return (
      await this.db
        .prepare(
          `SELECT id,event_date,kind,status,amount_cents,event_json FROM financial_events
       ${ids ? "WHERE id IN (SELECT value FROM json_each(?))" : ""}`,
        )
        .bind(...(ids ? [JSON.stringify(ids)] : []))
        .all<SavedEvent>()
    ).results;
  }

  private eventUpdates(
    events: FinancialEvent[],
    saved: SavedEvent[],
    valuations: Record<string, Valuation>,
    at: string,
  ): D1PreparedStatement[] {
    const byId = new Map(saved.map((e) => [e.id, e]));
    const statements: D1PreparedStatement[] = [];
    for (const event of events) {
      if (event.valuation && !valuations[event.id])
        statements.push(
          this.db
            .prepare(
              "INSERT OR IGNORE INTO historical_prices(event_id,valuation_json,created_at) VALUES(?,?,?)",
            )
            .bind(event.id, JSON.stringify(event.valuation), at),
        );
      const old = byId.get(event.id),
        json = JSON.stringify(event);
      if (
        !old ||
        old.event_date !== event.date ||
        old.kind !== event.kind ||
        old.status !== event.status ||
        old.amount_cents !== event.amountCents ||
        old.event_json !== json
      )
        statements.push(this.eventStatement(event, json));
    }
    return statements;
  }

  /** Private maintenance only. Idle polling deliberately does not repair old caches. */
  async rebuildEventCache(): Promise<void> {
    const revision = await this.revision();
    const [sources, accounts, overrides, valuations, saved] = await Promise.all(
      [
        this.sources(),
        this.accounts(),
        this.overrides(),
        this.valuations(),
        this.savedEvents(),
      ],
    );
    await this.db.batch([
      ...this.guard(revision),
      this.db.prepare(
        "INSERT INTO ledger_meta(id,revision) SELECT 1,0 WHERE EXISTS (SELECT 1 FROM sync_state WHERE lease_id IS NOT NULL)",
      ),
      ...this.eventUpdates(
        reclassify(sources, accounts, overrides, valuations),
        saved,
        valuations,
        new Date().toISOString(),
      ),
    ]);
  }
  async events(): Promise<FinancialEvent[]> {
    // Rules apply to saved evidence immediately, without a sync or browser write.
    const [sources, accounts, overrides, valuations] = await Promise.all([
      this.sources(),
      this.accounts(),
      this.overrides(),
      this.valuations(),
    ]);
    return reclassify(sources, accounts, overrides, valuations);
  }
  overrides() {
    return this.jsonRows<Override>(
      "SELECT override_json FROM event_overrides ORDER BY sequence",
      "override_json",
    );
  }
  async valuations(): Promise<Record<string, Valuation>> {
    return Object.fromEntries(
      (
        await this.db
          .prepare("SELECT event_id, valuation_json FROM historical_prices")
          .all<{ event_id: string; valuation_json: string }>()
      ).results.map((r) => [r.event_id, JSON.parse(r.valuation_json)]),
    );
  }
  async coverage(): Promise<Coverage[]> {
    const stored = await this.jsonRows<Coverage>(
      "SELECT coverage_json FROM sync_state",
      "coverage_json",
    );
    return (["checking", "investments"] as const).map((p) => {
      const coverage =
        stored.find((c) => c.product === p) ?? defaultCoverage(p);
      return p === "investments" &&
        coverage.limitation.startsWith("Incoming-share coverage is unverified.")
        ? { ...coverage, limitation: defaultCoverage(p).limitation }
        : coverage;
    });
  }
  async cursor(product: Coverage["product"]): Promise<string | null> {
    return (
      (
        await this.db
          .prepare("SELECT cursor FROM sync_state WHERE product = ?")
          .bind(product)
          .first<{ cursor: string | null }>()
      )?.cursor ?? null
    );
  }
  async acquire(
    product: Coverage["product"],
    now: string,
  ): Promise<string | null> {
    const leaseId = crypto.randomUUID();
    const until = new Date(Date.parse(now) + 15 * 60_000).toISOString();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO sync_state(product, coverage_json) VALUES (?, ?)",
      )
      .bind(product, JSON.stringify(defaultCoverage(product)))
      .run();
    const result = await this.db
      .prepare(
        "UPDATE sync_state SET lease_id = ?, lease_until = ? WHERE product = ? AND (lease_until IS NULL OR lease_until < ?)",
      )
      .bind(leaseId, until, product, now)
      .run();
    if (result.meta.changes !== 1) return null;
    await this.db
      .prepare(
        "INSERT INTO sync_runs(id, product, started_at, status) VALUES (?, ?, ?, ?)",
      )
      .bind(leaseId, product, now, "running")
      .run();
    return leaseId;
  }
  private sourceStatement(write: SourceWrite) {
    const s = write.record;
    return this.db
      .prepare(
        `INSERT INTO source_records(id, source_kind, provider_id, account_id, event_date, revision, record_json, raw_json, removed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET event_date=excluded.event_date,
      revision=excluded.revision, record_json=excluded.record_json, raw_json=excluded.raw_json, removed=excluded.removed
      WHERE source_records.event_date IS NOT excluded.event_date
        OR source_records.revision IS NOT excluded.revision
        OR source_records.record_json IS NOT excluded.record_json
        OR source_records.raw_json IS NOT excluded.raw_json
        OR source_records.removed IS NOT excluded.removed`,
      )
      .bind(
        eventId(s),
        s.kind,
        s.id,
        s.accountId,
        s.date,
        s.revision,
        JSON.stringify(s),
        write.raw,
        s.removed ? 1 : 0,
      );
  }
  private eventStatement(e: FinancialEvent, json = JSON.stringify(e)) {
    return this.db
      .prepare(
        `INSERT INTO financial_events(id, event_date, kind, status, amount_cents, event_json)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET event_date=excluded.event_date,
      kind=excluded.kind, status=excluded.status, amount_cents=excluded.amount_cents, event_json=excluded.event_json
      WHERE financial_events.event_date IS NOT excluded.event_date
        OR financial_events.kind IS NOT excluded.kind
        OR financial_events.status IS NOT excluded.status
        OR financial_events.amount_cents IS NOT excluded.amount_cents
        OR financial_events.event_json IS NOT excluded.event_json`,
      )
      .bind(e.id, e.date, e.kind, e.status, e.amountCents, json);
  }
  /** One D1 batch transaction publishes sources, derived events and cursor together. */
  async commitSync(commit: SyncCommit): Promise<void> {
    const lease = await this.db
      .prepare("SELECT lease_id, lease_until FROM sync_state WHERE product = ?")
      .bind(commit.product)
      .first<{ lease_id: string; lease_until: string }>();
    if (
      lease?.lease_id !== commit.leaseId ||
      lease.lease_until < new Date().toISOString()
    )
      throw new ConflictError("Sync lease expired");
    const revision = await this.revision();
    // Read only provider IDs and the explicitly reconciled brokerage window.
    const rows = await this.sourceRows(
      [
        ...new Set([
          ...commit.writes.map((w) => eventId(w.record)),
          ...commit.removed,
        ]),
      ],
      commit.reconcileWindow,
    );
    const existing = new Map(rows.map((row) => [row.id, row]));
    const changes = commit.writes.filter((w) => {
      const old = existing.get(eventId(w.record));
      return (
        !old ||
        old.record_json !== JSON.stringify(w.record) ||
        old.raw_json !== w.raw
      );
    });
    const removed = new Set(commit.removed);
    if (commit.reconcileWindow) {
      const window = commit.reconcileWindow,
        present = new Set(window.presentIds);
      for (const row of rows) {
        const source = this.sourceFromRow(row);
        if (
          polledInvestment(source) &&
          source.date >= window.start &&
          source.date <= window.end &&
          !present.has(row.id)
        )
          removed.add(row.id);
      }
    }
    const current = new Map(existing);
    for (const write of changes)
      current.set(eventId(write.record), {
        id: eventId(write.record),
        record_json: JSON.stringify(write.record),
        raw_json: write.raw,
      });
    // Preserve raw evidence; a repeated tombstone needs no write or classification.
    const removedWrites = [...removed].flatMap((id) => {
      const old = current.get(id);
      if (!old) return [];
      const record = this.sourceFromRow(old);
      return record.removed
        ? []
        : [{ record: { ...record, removed: true }, raw: old.raw_json }];
    });
    const newRecords = [...changes, ...removedWrites];
    const seeds = newRecords.flatMap((w) => {
      const old = existing.get(eventId(w.record));
      if (
        old &&
        JSON.stringify(this.sourceFromRow(old)) ===
          JSON.stringify(
            this.sourceFromRow({
              record_json: JSON.stringify(w.record),
              raw_json: w.raw,
            }),
          )
      )
        return [];
      return old ? [this.sourceFromRow(old), w.record] : [w.record];
    });
    let eventStatements: D1PreparedStatement[] = [];
    if (seeds.length) {
      // Publish the six-day dependency neighborhood. An extra six-day margin
      // supplies reciprocal competing matches without publishing partial edge rows.
      const windows = sourceWindows(seeds, 12);
      const nearby = (
        await this.db
          .prepare(
            `SELECT s.id,s.record_json,s.raw_json FROM json_each(?) AS w
         CROSS JOIN source_records AS s INDEXED BY source_date
         WHERE s.event_date BETWEEN json_extract(w.value,'$.start') AND json_extract(w.value,'$.end')`,
          )
          .bind(JSON.stringify(windows))
          .all<SavedSource>()
      ).results;
      const context = new Map(
        nearby.map((row) => [row.id, this.sourceFromRow(row)]),
      );
      for (const write of newRecords)
        context.set(
          eventId(write.record),
          this.sourceFromRow({
            record_json: JSON.stringify(write.record),
            raw_json: write.raw,
          }),
        );
      const ids = [...context.keys()],
        affected = [...context.values()].filter((s) =>
          affectedSource(s, seeds),
        );
      const payload = JSON.stringify(ids);
      const [accounts, overrides, priceRows, saved] = await Promise.all([
        this.accounts(),
        this.jsonRows<Override>(
          "SELECT override_json FROM event_overrides WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY sequence",
          "override_json",
          payload,
        ),
        this.db
          .prepare(
            "SELECT event_id,valuation_json FROM historical_prices WHERE event_id IN (SELECT value FROM json_each(?))",
          )
          .bind(payload)
          .all<{ event_id: string; valuation_json: string }>(),
        this.savedEvents(affected.map(eventId)),
      ]);
      const valuations = Object.fromEntries(
        priceRows.results.map((r) => [
          r.event_id,
          JSON.parse(r.valuation_json),
        ]),
      );
      const affectedIds = new Set(affected.map(eventId));
      eventStatements = this.eventUpdates(
        reclassify(
          [...context.values()],
          accounts,
          overrides,
          valuations,
        ).filter((e) => affectedIds.has(e.id)),
        saved,
        valuations,
        commit.coverage.lastSuccess!,
      );
    }
    // Guard against an expired/replaced lease inside the atomic transaction too.
    const statements: D1PreparedStatement[] = [
      ...this.guard(revision),
      this.db
        .prepare(
          `INSERT INTO sync_runs(id, product, started_at, status)
      SELECT ?, ?, ?, 'lease-guard' WHERE NOT EXISTS (SELECT 1 FROM sync_state WHERE product=? AND lease_id=?)`,
        )
        .bind(
          commit.leaseId,
          commit.product,
          commit.coverage.lastAttempt,
          commit.product,
          commit.leaseId,
        ),
    ];
    for (const write of [...changes, ...removedWrites])
      statements.push(this.sourceStatement(write));
    statements.push(...eventStatements);
    statements.push(
      this.db
        .prepare(
          `UPDATE sync_state SET cursor=?, coverage_json=json_set(?, '$.mostRecentDate',
           ${
             seeds.length
               ? `(SELECT event_date FROM source_records INDEXED BY source_date
            WHERE source_kind=? AND removed=0 AND (?='investment' OR json_extract(record_json,'$.pending') IS NOT 1)
            ORDER BY event_date DESC LIMIT 1)`
               : "json_extract(sync_state.coverage_json,'$.mostRecentDate')"
           }),
           lease_id=NULL, lease_until=NULL WHERE product=? AND lease_id=?`,
        )
        .bind(
          commit.cursor,
          JSON.stringify(commit.coverage),
          ...(seeds.length
            ? [
                commit.product === "checking" ? "bank" : "investment",
                commit.product === "checking" ? "bank" : "investment",
              ]
            : []),
          commit.product,
          commit.leaseId,
        ),
    );
    statements.push(
      this.db
        .prepare(
          "UPDATE sync_runs SET completed_at=?, status='success' WHERE id=?",
        )
        .bind(commit.coverage.lastSuccess, commit.leaseId),
    );
    statements.push(
      this.db
        .prepare("DELETE FROM sync_jobs WHERE product=? AND requested_at <= ?")
        .bind(commit.product, commit.coverage.lastAttempt),
    );
    await this.db.batch(statements);
  }
  async failSync(
    product: Coverage["product"],
    leaseId: string,
    now: string,
    code: string,
  ) {
    const coverage = (await this.coverage()).find(
      (c) => c.product === product,
    )!;
    coverage.error = code;
    coverage.lastAttempt = now;
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE sync_state SET coverage_json=?, lease_id=NULL, lease_until=NULL WHERE product=? AND lease_id=?",
        )
        .bind(JSON.stringify(coverage), product, leaseId),
      this.db
        .prepare(
          "UPDATE sync_runs SET completed_at=?, status='failed', error_code=? WHERE id=?",
        )
        .bind(now, code, leaseId),
    ]);
  }
  async saveOverride(override: Override): Promise<FinancialEvent> {
    const revision = await this.revision();
    const source = (await this.sources()).find(
      (s) => eventId(s) === override.eventId,
    );
    if (!source || source.revision !== override.baseRevision)
      throw new ConflictError("Record changed; reload before reviewing");
    const events = reclassify(
      await this.sources(),
      await this.accounts(),
      [...(await this.overrides()), override],
      await this.valuations(),
    );
    const event = events.find((e) => e.id === override.eventId)!;
    if (event.status !== "confirmed" && override.kind !== "unknown")
      throw new Error(event.reason);
    // Revision is checked again in SQL to prevent approval of a concurrent correction.
    await this.db.batch([
      ...this.guard(revision),
      this.db
        .prepare(
          `INSERT INTO event_overrides(id,event_id,override_json,created_at) SELECT ?,?,?,? WHERE EXISTS
        (SELECT 1 FROM source_records WHERE id=? AND revision=?)`,
        )
        .bind(
          override.id,
          override.eventId,
          JSON.stringify(override),
          override.createdAt,
          override.eventId,
          override.baseRevision,
        ),
      ...events.map((e) => this.eventStatement(e)),
      ...(override.valuation
        ? [
            this.db
              .prepare(
                "INSERT OR IGNORE INTO historical_prices(event_id,valuation_json,created_at) VALUES(?,?,?)",
              )
              .bind(
                override.eventId,
                JSON.stringify(override.valuation),
                override.createdAt,
              ),
          ]
        : []),
    ]);
    if (
      !(await this.db
        .prepare("SELECT id FROM event_overrides WHERE id=?")
        .bind(override.id)
        .first())
    )
      throw new ConflictError("Record changed; reload before reviewing");
    return event;
  }
  async saveManual(write: SourceWrite, override: Override): Promise<void> {
    const revision = await this.revision();
    const existing = (await this.sources()).find(
      (s) => eventId(s) === eventId(write.record),
    );
    if (existing)
      throw new ConflictError(
        "This receipt reference already exists; review the existing event",
      );
    const events = reclassify(
      [...(await this.sources()), write.record],
      await this.accounts(),
      [...(await this.overrides()), override],
      await this.valuations(),
    );
    const event = events.find((e) => e.id === override.eventId)!;
    if (event.status !== "confirmed") throw new Error(event.reason);
    await this.db.batch([
      ...this.guard(revision),
      // A duplicate stable reference aborts the entire transaction.
      this.db
        .prepare(
          "INSERT INTO source_records(id,source_kind,provider_id,account_id,event_date,revision,record_json,raw_json) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          eventId(write.record),
          write.record.kind,
          write.record.id,
          write.record.accountId,
          write.record.date,
          write.record.revision,
          JSON.stringify(write.record),
          write.raw,
        ),
      ...events.map((e) => this.eventStatement(e)),
      this.db
        .prepare(
          "INSERT INTO event_overrides(id,event_id,override_json,created_at) VALUES (?,?,?,?)",
        )
        .bind(
          override.id,
          override.eventId,
          JSON.stringify(override),
          override.createdAt,
        ),
      ...(override.valuation
        ? [
            this.db
              .prepare(
                "INSERT OR IGNORE INTO historical_prices(event_id,valuation_json,created_at) VALUES(?,?,?)",
              )
              .bind(
                override.eventId,
                JSON.stringify(override.valuation),
                override.createdAt,
              ),
          ]
        : []),
    ]);
  }
}
