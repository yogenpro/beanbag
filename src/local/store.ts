import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { sqliteAdapter } from "./sqlite";
import { D1Ledger } from "../data/d1";
import { decryptToken, encryptToken } from "../providers/plaid/secrets";
import type { LocalConfig } from "./config";
import {
  createPrivate,
  LocalError,
  privateDirectory,
  privateFile,
  readPrivate,
} from "./files";

export type LinkState = {
  linkToken: string;
  url: string;
  expiration: string;
  exchange?: { itemId: string; token: string; selectedIds: string[] };
  cleanup?: boolean;
};

export function openLocalStore(config: LocalConfig) {
  process.umask(0o077);
  privateDirectory(config.project, config.stateDirectory, true);
  const path = join(config.stateDirectory, "ledger.sqlite");
  const lock = join(config.stateDirectory, "command.lock");
  if (existsSync(lock))
    throw new LocalError(
      "Another local command holds command.lock. If it crashed, verify that it stopped before removing that private lock file.",
    );
  createPrivate(config.project, lock, String(process.pid) + "\n");
  let sqlite: DatabaseSync | undefined;
  try {
    const existed = existsSync(path);
    if (!existsSync(config.keyFile)) {
      if (existed)
        throw new LocalError(
          "The existing ledger needs its original encryption key. Restore that key; it will not be replaced.",
        );
      createPrivate(
        config.project,
        config.keyFile,
        randomBytes(32).toString("base64") + "\n",
      );
    }
    const key = readPrivate(config.project, config.keyFile).trim();
    if (
      !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
      Buffer.from(key, "base64").length !== 32
    )
      throw new LocalError(
        "The private encryption key must contain 32 base64-encoded bytes.",
      );
    if (!existed) createPrivate(config.project, path, "");
    privateFile(config.project, path);
    for (const suffix of ["-journal", "-wal", "-shm"])
      if (existsSync(path + suffix)) privateFile(config.project, path + suffix);
    sqlite = new DatabaseSync(path);
    sqlite.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    const version = Number(
      sqlite.prepare("PRAGMA user_version").get()?.user_version,
    );
    const keyFingerprint = createHash("sha256").update(key).digest("hex");
    if (version === 0) {
      if (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .get()
      )
        throw new LocalError(
          "This database is not a local spike ledger; use a separate empty data directory.",
        );
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        sqlite.exec(
          readFileSync(
            join(config.project, "migrations/0001_ledger.sql"),
            "utf8",
          ),
        );
        sqlite.exec(
          "CREATE TABLE local_settings (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL, key_fingerprint TEXT NOT NULL, actor TEXT NOT NULL); CREATE TABLE local_link (id INTEGER PRIMARY KEY CHECK(id=1), encrypted_session TEXT NOT NULL); PRAGMA user_version=1;",
        );
        sqlite
          .prepare("INSERT INTO local_settings VALUES(1,?,?,?)")
          .run(config.fingerprint, keyFingerprint, crypto.randomUUID());
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    } else if (![1, 2].includes(version))
      throw new LocalError(
        "Unsupported local ledger version; use the matching application version.",
      );
    const settings = sqlite
      .prepare("SELECT * FROM local_settings WHERE id=1")
      .get();
    if (settings?.fingerprint !== config.fingerprint)
      throw new LocalError(
        "This local ledger belongs to different Plaid settings or account selections. Restore those settings or use a separate data directory.",
      );
    if (settings.key_fingerprint !== keyFingerprint)
      throw new LocalError(
        "This local ledger requires its original encryption key.",
      );
    if (version < 2) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        sqlite.exec(
          readFileSync(
            join(config.project, "migrations/0002_balances.sql"),
            "utf8",
          ),
        );
        sqlite.exec("PRAGMA user_version=2; COMMIT;");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
    const database = sqlite,
      db = sqliteAdapter(database),
      repo = new D1Ledger(db);
    return {
      db,
      repo,
      key,
      actor: String(settings.actor),
      async session(): Promise<LinkState | null> {
        const row = database
          .prepare("SELECT encrypted_session FROM local_link WHERE id=1")
          .get();
        return row
          ? JSON.parse(
              await decryptToken(
                String(row.encrypted_session),
                key,
                "local-link:" + config.fingerprint,
              ),
            )
          : null;
      },
      async saveSession(session: LinkState) {
        const encrypted = await encryptToken(
          JSON.stringify(session),
          key,
          "local-link:" + config.fingerprint,
        );
        database
          .prepare(
            "INSERT INTO local_link VALUES(1,?) ON CONFLICT(id) DO UPDATE SET encrypted_session=excluded.encrypted_session",
          )
          .run(encrypted);
      },
      clearSession() {
        database.prepare("DELETE FROM local_link").run();
      },
      close() {
        database.close();
        unlinkSync(lock);
      },
    };
  } catch (error) {
    sqlite?.close();
    unlinkSync(lock);
    throw error;
  }
}
export type LocalStore = ReturnType<typeof openLocalStore>;
