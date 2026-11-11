import { pacificToday, validDate } from "../../accounting/dates";
import { eventId, type Coverage } from "../../accounting/types";
import {
  defaultCoverage,
  type LedgerRepository,
  type SourceWrite,
} from "../../data/repository";
import { ProviderError, type JsonRecord, type PlaidApi } from "./client";
import { normalizeBank, normalizeInvestment } from "./normalize";

const MAX_RECORDS = 5000;
const MAX_PAGES = 100;
export class SyncService {
  constructor(
    private readonly api: PlaidApi,
    private readonly repo: LedgerRepository,
    private readonly token: string,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async checking(): Promise<"success" | "busy"> {
    const started = this.now().toISOString(),
      lease = await this.repo.acquire("checking", started);
    if (!lease) return "busy";
    try {
      const accounts = await this.repo.accounts(),
        checking = accounts.find((a) => a.role === "joint_checking");
      if (!checking) throw new ProviderError("ACCOUNT_CONFIGURATION_REQUIRED");
      const originalCursor = await this.repo.cursor("checking");
      let cursor = originalCursor,
        writes: SourceWrite[] = [],
        removed: string[] = [],
        completed = false;
      // A pagination mutation invalidates every page; restart from the original durable cursor.
      for (let attempt = 0; attempt < 3; attempt++) {
        writes = [];
        removed = [];
        cursor = originalCursor;
        completed = false;
        try {
          for (let page = 0; page < MAX_PAGES; page++) {
            const response = await this.api.post("/transactions/sync", {
              access_token: this.token,
              ...(cursor ? { cursor } : {}),
              count: 500,
              options: { account_id: checking.id },
            });
            if (
              !Array.isArray(response.added) ||
              !Array.isArray(response.modified) ||
              !Array.isArray(response.removed) ||
              typeof response.next_cursor !== "string" ||
              typeof response.has_more !== "boolean"
            )
              throw new ProviderError("INVALID_SYNC_RESPONSE");
            for (const raw of [
              ...response.added,
              ...response.modified,
            ] as JsonRecord[]) {
              if (raw.account_id !== checking.id) continue;
              const write = await normalizeBank(raw);
              writes.push(write);
              if (
                write.record.kind === "bank" &&
                write.record.pendingId &&
                !write.record.pending
              )
                removed.push(`bank:${write.record.pendingId}`);
            }
            removed.push(
              ...response.removed.map(
                (r: JsonRecord) => `bank:${r.transaction_id}`,
              ),
            );
            if (writes.length + removed.length > MAX_RECORDS)
              throw new ProviderError("BACKFILL_BATCH_TOO_LARGE");
            cursor = response.next_cursor;
            if (!response.has_more) {
              completed = true;
              break;
            }
          }
          break;
        } catch (error) {
          if (
            !(error instanceof ProviderError) ||
            error.code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" ||
            attempt === 2
          )
            throw error;
        }
      }
      if (!completed) throw new ProviderError("PAGINATION_LIMIT");
      const coverage = await this.health("checking", started, writes, removed);
      await this.repo.commitSync({
        product: "checking",
        leaseId: lease,
        writes,
        removed,
        cursor,
        coverage,
      });
      return "success";
    } catch (error) {
      await this.repo.failSync(
        "checking",
        lease,
        started,
        error instanceof ProviderError ? error.code : "SYNC_FAILED",
      );
      throw error;
    }
  }
  async investments(start?: string, end?: string): Promise<"success" | "busy"> {
    const started = this.now().toISOString(),
      lease = await this.repo.acquire("investments", started);
    if (!lease) return "busy";
    try {
      const account = (await this.repo.accounts()).find(
        (a) => a.role === "joint_brokerage",
      );
      if (!account) throw new ProviderError("ACCOUNT_CONFIGURATION_REQUIRED");
      end ??= pacificToday(this.now());
      start ??= new Date(Date.parse(end + "T12:00:00Z") - 90 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (
        !validDate(start) ||
        !validDate(end) ||
        start > end ||
        Date.parse(end) - Date.parse(start) > 366 * 86_400_000
      )
        throw new ProviderError("INVALID_BACKFILL_WINDOW");
      const writes: SourceWrite[] = [],
        removed: string[] = [];
      const seen = new Set<string>();
      let expected: number | null = null,
        complete = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await this.api.post("/investments/transactions/get", {
          access_token: this.token,
          start_date: start,
          end_date: end,
          options: {
            account_ids: [account.id],
            count: 100,
            offset: page * 100,
          },
        });
        const total = Number(String(response.total_investment_transactions));
        if (
          !Array.isArray(response.investment_transactions) ||
          !Array.isArray(response.securities) ||
          !Number.isSafeInteger(total) ||
          total < 0 ||
          total > MAX_RECORDS
        )
          throw new ProviderError("INVALID_INVESTMENTS_RESPONSE");
        if (expected !== null && total !== expected)
          throw new ProviderError("INVESTMENT_PAGINATION_CHANGED");
        expected = total;
        for (const raw of response.investment_transactions as JsonRecord[]) {
          if (raw.account_id !== account.id) continue;
          if (seen.has(raw.investment_transaction_id))
            throw new ProviderError("INVESTMENT_PAGINATION_CHANGED");
          seen.add(raw.investment_transaction_id);
          const write = await normalizeInvestment(raw, response.securities);
          writes.push(write);
          if (write.record.kind === "investment" && write.record.cancelledId)
            removed.push(`investment:${write.record.cancelledId}`);
        }
        if (page * 100 + response.investment_transactions.length >= total) {
          complete = true;
          break;
        }
        if (response.investment_transactions.length === 0)
          throw new ProviderError("INVESTMENT_PAGINATION_CHANGED");
      }
      if (!complete) throw new ProviderError("PAGINATION_LIMIT");
      const reconciliation = {
        start,
        end,
        presentIds: writes.map((w) => eventId(w.record)),
      };
      const coverage = await this.health(
        "investments",
        started,
        writes,
        removed,
        reconciliation,
      );
      coverage.startDate = start;
      await this.repo.commitSync({
        product: "investments",
        leaseId: lease,
        writes,
        removed,
        cursor: null,
        coverage,
        reconcileWindow: reconciliation,
      });
      return "success";
    } catch (error) {
      await this.repo.failSync(
        "investments",
        lease,
        started,
        error instanceof ProviderError ? error.code : "SYNC_FAILED",
      );
      throw error;
    }
  }
  private async health(
    product: Coverage["product"],
    started: string,
    writes: SourceWrite[],
    removed: string[],
    reconciliation?: { start: string; end: string; presentIds: string[] },
  ): Promise<Coverage> {
    const previous =
      (await this.repo.coverage()).find((c) => c.product === product) ??
      defaultCoverage(product);
    const records = new Map(
      (await this.repo.sources()).map((s) => [eventId(s), s]),
    );
    for (const write of writes)
      records.set(eventId(write.record), write.record);
    for (const id of removed) records.delete(id);
    if (reconciliation)
      for (const [id, source] of records) {
        if (
          source.kind === "investment" &&
          !source.manual &&
          source.date >= reconciliation.start &&
          source.date <= reconciliation.end &&
          !reconciliation.presentIds.includes(id)
        )
          records.delete(id);
      }
    const dates = [...records.values()]
      .filter(
        (s) =>
          !s.removed &&
          (product === "checking"
            ? s.kind === "bank" && !s.pending
            : s.kind === "investment"),
      )
      .map((s) => s.date)
      .sort();
    return {
      ...previous,
      lastAttempt: started,
      lastSuccess: this.now().toISOString(),
      mostRecentDate: dates.at(-1) ?? null,
      completeThrough: null,
      error: null,
      limitation:
        product === "checking"
          ? "Only the selected checking stream is ingested. Provider refresh times do not establish a complete-through date."
          : previous.limitation,
    };
  }
}
