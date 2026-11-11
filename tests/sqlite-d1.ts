import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

/** Exercises the real SQLite migration and SQL transactions without a network/provider. */
export function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_ledger.sql", import.meta.url),
      "utf8",
    ),
  );
  const makeStatement = (
    sql: string,
    values: any[] = [],
  ): D1PreparedStatement => {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...args: any[]) => makeStatement(sql, args),
      first: async (column?: string) => {
        const row = statement.get(...values) as
          Record<string, unknown> | undefined;
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
      all: async () => ({
        results: statement.all(...values),
        success: true,
        meta: { changes: 0 },
      }),
      run: async () => {
        const result = statement.run(...values);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes) },
        };
      },
      raw: async () => statement.all(...values),
    } as unknown as D1PreparedStatement;
  };
  const db = {
    prepare: (sql: string) => makeStatement(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
