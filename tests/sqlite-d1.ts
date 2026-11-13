import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteAdapter } from "../src/local/sqlite";

/** Exercises the real SQLite migration and SQL transactions without a network/provider. */
export function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_ledger.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0002_balances.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0003_account_history.sql", import.meta.url),
      "utf8",
    ),
  );
  return { db: sqliteAdapter(sqlite), sqlite };
}
