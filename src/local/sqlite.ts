import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** The D1 subset used by the ledger, backed by Node SQLite. Not a Worker binding. */
export function sqliteAdapter(sqlite: DatabaseSync): D1Database {
  const statements = new WeakMap<
    object,
    { sql: string; values: SQLInputValue[] }
  >();
  const execute = (sql: string, values: SQLInputValue[]) => {
    const result = sqlite.prepare(sql).run(...values);
    return {
      success: true as const,
      results: [],
      meta: { changes: Number(result.changes) },
    };
  };
  const prepare = (
    sql: string,
    values: SQLInputValue[] = [],
  ): D1PreparedStatement => {
    const statement = {
      bind: (...args: SQLInputValue[]) => prepare(sql, args),
      first: async (column?: string) => {
        const row = sqlite.prepare(sql).get(...values);
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
      all: async () => ({
        results: sqlite.prepare(sql).all(...values),
        success: true,
        meta: { changes: 0 },
      }),
      run: async () => execute(sql, values),
    } as unknown as D1PreparedStatement;
    statements.set(statement, { sql, values });
    return statement;
  };
  return {
    prepare,
    batch: async (batch: D1PreparedStatement[]) => {
      // No await within the transaction: other promises cannot join this batch.
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = batch.map((statement) => {
          const query = statements.get(statement);
          if (!query) throw new Error("Statement belongs to another database");
          return execute(query.sql, query.values);
        });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
