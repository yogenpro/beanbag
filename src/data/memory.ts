import type {
  Account,
  Coverage,
  FinancialEvent,
  Override,
  Source,
  Valuation,
} from "../accounting/types";
import { eventId } from "../accounting/types";
import { classify } from "../accounting/classify";
import {
  defaultCoverage,
  reclassify,
  type LedgerRepository,
  type SourceWrite,
  type SyncCommit,
} from "./repository";
import { ConflictError } from "./d1";
import {
  emptyBalanceHealth,
  type BalanceSnapshot,
} from "../accounting/balances";

/** Local synthetic preview and test adapter. Never selected on a public hostname. */
export class MemoryLedger implements LedgerRepository {
  snapshots: BalanceSnapshot[] = [];
  balanceStatus = emptyBalanceHealth();
  async balanceSnapshots() {
    return structuredClone(this.snapshots);
  }
  async balanceHealth() {
    return structuredClone(this.balanceStatus);
  }
  async saveBalanceSnapshot(snapshot: BalanceSnapshot) {
    if (!this.snapshots.some((s) => s.capturedAt === snapshot.capturedAt))
      this.snapshots.push(structuredClone(snapshot));
    if (
      !this.balanceStatus.lastAttempt ||
      snapshot.capturedAt >= this.balanceStatus.lastAttempt
    )
      this.balanceStatus = {
        lastAttempt: snapshot.capturedAt,
        lastSuccess: snapshot.capturedAt,
        error: null,
      };
  }
  async failBalanceRefresh(at: string, error: string) {
    if (!this.balanceStatus.lastAttempt || at >= this.balanceStatus.lastAttempt)
      this.balanceStatus = { ...this.balanceStatus, lastAttempt: at, error };
  }
  records = new Map<string, Source>();
  decisions: Override[] = [];
  prices: Record<string, Valuation> = {};
  health = [defaultCoverage("checking"), defaultCoverage("investments")];
  cursors = new Map<string, string | null>();
  leases = new Map<string, string>();
  constructor(
    readonly selected: Account[],
    sources: Source[] = [],
  ) {
    for (const s of sources) this.records.set(eventId(s), s);
  }
  async accounts() {
    return structuredClone(this.selected);
  }
  async sources() {
    return structuredClone([...this.records.values()]);
  }
  async overrides() {
    return structuredClone(this.decisions);
  }
  async valuations() {
    return structuredClone(this.prices);
  }
  async coverage() {
    return structuredClone(this.health);
  }
  async events(): Promise<FinancialEvent[]> {
    return reclassify(
      await this.sources(),
      this.selected,
      this.decisions,
      this.prices,
    );
  }
  async cursor(product: Coverage["product"]) {
    return this.cursors.get(product) ?? null;
  }
  async acquire(product: Coverage["product"]) {
    if (this.leases.has(product)) return null;
    const id = crypto.randomUUID();
    this.leases.set(product, id);
    return id;
  }
  async commitSync(commit: SyncCommit) {
    if (this.leases.get(commit.product) !== commit.leaseId)
      throw new ConflictError("Lease changed");
    for (const write of commit.writes)
      this.records.set(eventId(write.record), structuredClone(write.record));
    const removed = new Set(commit.removed);
    if (commit.reconcileWindow) {
      const w = commit.reconcileWindow;
      for (const [id, source] of this.records)
        if (
          source.kind === "investment" &&
          !source.manual &&
          source.date >= w.start &&
          source.date <= w.end &&
          !w.presentIds.includes(id)
        )
          removed.add(id);
    }
    for (const id of removed) {
      const source = this.records.get(id);
      if (source) this.records.set(id, { ...source, removed: true });
    }
    this.health = this.health.map((h) =>
      h.product === commit.product ? commit.coverage : h,
    );
    this.cursors.set(commit.product, commit.cursor);
    this.leases.delete(commit.product);
  }
  async failSync(
    product: Coverage["product"],
    lease: string,
    now: string,
    code: string,
  ) {
    if (this.leases.get(product) !== lease) return;
    this.health = this.health.map((h) =>
      h.product === product ? { ...h, lastAttempt: now, error: code } : h,
    );
    this.leases.delete(product);
  }
  async saveOverride(override: Override) {
    const source = this.records.get(override.eventId);
    if (!source || source.revision !== override.baseRevision)
      throw new ConflictError("Source changed");
    const event = reclassify(
      await this.sources(),
      this.selected,
      [...this.decisions, override],
      this.prices,
    ).find((e) => e.id === override.eventId)!;
    if (event.status !== "confirmed" && override.kind !== "unknown")
      throw new Error(event.reason);
    this.decisions.push(structuredClone(override));
    return event;
  }
  async saveManual(write: SourceWrite, override: Override) {
    if (this.records.has(eventId(write.record)))
      throw new ConflictError("Duplicate receipt reference");
    const event = reclassify(
      [...(await this.sources()), write.record],
      this.selected,
      [...this.decisions, override],
      this.prices,
    ).find((e) => e.id === override.eventId)!;
    if (event.status !== "confirmed") throw new Error(event.reason);
    this.records.set(eventId(write.record), write.record);
    this.decisions.push(override);
  }
}
