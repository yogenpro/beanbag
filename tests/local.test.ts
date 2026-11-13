import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/local/cli";
import { loadLocalConfig, type LocalConfig } from "../src/local/config";
import {
  beginLink,
  cancelLink,
  completeLink,
  connection,
} from "../src/local/link";
import { openLocalStore, type LocalStore } from "../src/local/store";
import { privateLocation } from "../src/local/files";
import { decryptToken } from "../src/providers/plaid/secrets";
import {
  ProviderError,
  type JsonRecord,
  type PlaidApi,
} from "../src/providers/plaid/client";
import { SyncService } from "../src/providers/plaid/sync";
import {
  accounts,
  rawBank,
  rawInvestment,
  override,
  valuation,
} from "./fixtures";

const project = resolve(import.meta.dirname, "..");
const credentials =
  "PLAID_CLIENT_ID=synthetic-local-client\nPLAID_SECRET=synthetic-local-secret\nPLAID_ENV=sandbox\nCHECKING_ACCOUNT_MASK=0001\nBROKERAGE_ACCOUNT_MASK=0002\n";
const accessToken = "synthetic-private-item-token";
const linkToken = "synthetic-private-link-token";
const linkUrl = "https://secure.plaid.com/hl/synthetic-consent";
const providerAccounts = [
  {
    account_id: accounts[0].id,
    mask: "0001",
    type: "depository",
    subtype: "checking",
  },
  {
    account_id: accounts[1].id,
    mask: "0002",
    type: "investment",
    subtype: "brokerage",
  },
  {
    account_id: "unselected",
    mask: "0003",
    type: "depository",
    subtype: "savings",
  },
];
const completed = () => ({
  link_sessions: [
    {
      results: {
        item_add_results: [
          {
            public_token: "synthetic-private-public-token",
            accounts: accounts.map((a) => ({ id: a.id })),
          },
        ],
      },
    },
  ],
});

function fakeApi(
  overrides: Record<
    string,
    (body: JsonRecord) => JsonRecord | Promise<JsonRecord>
  > = {},
) {
  const post = vi.fn(async (path: string, body: JsonRecord) => {
    if (overrides[path]) return overrides[path](body);
    if (path === "/link/token/create")
      return {
        link_token: linkToken,
        hosted_link_url: linkUrl,
        expiration: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
    if (path === "/link/token/get") return completed();
    if (path === "/item/public_token/exchange")
      return { item_id: "synthetic-item", access_token: accessToken };
    if (path === "/accounts/get") return { accounts: providerAccounts };
    if (path === "/item/remove") return { removed: true };
    throw new Error("Unexpected test API path");
  });
  return { api: { post } as PlaidApi, post };
}

let directory: string, env: NodeJS.ProcessEnv, config: LocalConfig;
const opened = new Set<LocalStore>();
function open() {
  const store = openLocalStore(config);
  opened.add(store);
  return store;
}
function close(store: LocalStore) {
  store.close();
  opened.delete(store);
}
async function invoke(args: string[], settings = env) {
  let output = "";
  const status = await main(args, project, settings, (chunk) => {
    output += chunk;
  });
  for (const value of [
    "synthetic-local-client",
    "synthetic-local-secret",
    accessToken,
    linkToken,
    "synthetic-private-public-token",
  ])
    expect(output).not.toContain(value);
  return { status, output };
}
beforeEach(() => {
  // Build containers can supply TMPDIR under a parent owned by another UID.
  // Fixtures must satisfy the real private-path guard, just like operator data.
  let selected: string | undefined;
  for (const base of new Set([tmpdir(), "/tmp", "/var/tmp"])) {
    let candidate: string | undefined;
    try {
      candidate = mkdtempSync(join(realpathSync(base), "beanbag-local-test-"));
      privateLocation(project, candidate);
      selected = candidate;
      break;
    } catch {
      if (candidate) rmSync(candidate, { recursive: true, force: true });
    }
  }
  if (!selected)
    throw new Error("No trusted temporary directory for local CLI fixtures");
  directory = selected;
  mkdirSync(join(directory, "config"), { mode: 0o700 });
  env = {
    BEANBAG_LOCAL_ENV_FILE: join(directory, "config/plaid.env"),
    BEANBAG_LOCAL_STATE_DIR: join(directory, "data"),
    BEANBAG_LOCAL_KEY_FILE: join(directory, "config/local.key"),
  };
  writeFileSync(env.BEANBAG_LOCAL_ENV_FILE!, credentials, { mode: 0o600 });
  config = loadLocalConfig(project, env);
});
afterEach(() => {
  for (const store of opened) store.close();
  opened.clear();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("private local configuration and storage", () => {
  it("imports explicitly mapped daily values privately without contacting a provider or changing events", async () => {
    const store = open();
    const { api, post } = fakeApi();
    await beginLink(store, api);
    await completeLink(store, api, config);
    close(store);
    const file = join(directory, "config", "daily-values.csv");
    writeFileSync(file, 'Date,Amount\n08/12/2026,"$12,345.67"\n', {
      mode: 0o600,
    });
    const before = post.mock.calls.length;
    expect(
      (await invoke(["import-history", "brokerage", file, "Amount"])).status,
    ).toBe(0);
    const imported = open();
    expect(await imported.repo.accountValueHistory()).toMatchObject([
      {
        accountId: accounts[1].id,
        netValueCents: 1234567,
        method: "institution_export",
      },
    ]);
    expect(await imported.repo.events()).toEqual([]);
    expect(post.mock.calls).toHaveLength(before);
  });
  it("upgrades a version-one local ledger without replacing credentials, accounts or sources", async () => {
    const original = open();
    const { api } = fakeApi();
    await beginLink(original, api);
    await completeLink(original, api, config);
    const key = original.key;
    const item = await connection(original);
    close(original);
    const sqlite = new DatabaseSync(
      join(config.stateDirectory, "ledger.sqlite"),
    );
    sqlite.exec(
      "DROP TABLE account_value_reconstructions; DROP TABLE account_value_history; DROP TABLE balance_snapshots; DROP TABLE balance_refresh; PRAGMA user_version=1;",
    );
    sqlite.close();
    const upgraded = open();
    expect(upgraded.key).toBe(key);
    expect(await connection(upgraded)).toEqual(item);
    expect(await upgraded.repo.accounts()).toHaveLength(2);
    expect(await upgraded.repo.balanceSnapshots()).toEqual([]);
    expect(
      (
        await upgraded.db
          .prepare("PRAGMA user_version")
          .first<{ user_version: number }>()
      )?.user_version,
    ).toBe(4);
  });
  it("validates without writing data, reading inherited keys or making network requests", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network must not run"));
    expect(
      await invoke(["check-config"], {
        ...env,
        PLAID_ENV: "production",
        PLAID_CLIENT_ID: "inherited-live",
        PLAID_SECRET: "inherited-live",
      }),
    ).toMatchObject({
      status: 0,
      output: expect.stringContaining("no network requests"),
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(readdirSync(directory)).toEqual(["config"]);
    expect(readdirSync(join(directory, "config"))).toEqual(["plaid.env"]);
  });
  it("rejects placeholders, missing selections and fallback to inherited credentials", async () => {
    for (const text of [
      credentials.replace("synthetic-local-secret", "replace_locally"),
      credentials.replace(
        "CHECKING_ACCOUNT_MASK=0001",
        "CHECKING_ACCOUNT_MASK=",
      ),
      "PLAID_ENV=production\n",
    ]) {
      writeFileSync(env.BEANBAG_LOCAL_ENV_FILE!, text);
      expect(
        (
          await invoke(["check-config"], {
            ...env,
            PLAID_CLIENT_ID: "inherited",
            PLAID_SECRET: "inherited",
          })
        ).status,
      ).toBe(1);
    }
  });
  it("rejects repository paths, links, permissive files and writable parents", async () => {
    expect(
      (
        await invoke(["check-config"], {
          ...env,
          BEANBAG_LOCAL_ENV_FILE: join(project, ".env.live"),
        })
      ).status,
    ).toBe(1);
    const symlink = join(directory, "alias");
    symlinkSync(join(directory, "config"), symlink);
    expect(
      (
        await invoke(["check-config"], {
          ...env,
          BEANBAG_LOCAL_ENV_FILE: join(symlink, "plaid.env"),
        })
      ).status,
    ).toBe(1);
    const hardlink = join(directory, "config/alias.env");
    linkSync(env.BEANBAG_LOCAL_ENV_FILE!, hardlink);
    expect((await invoke(["check-config"])).status).toBe(1);
    unlinkSync(hardlink);
    chmodSync(env.BEANBAG_LOCAL_ENV_FILE!, 0o644);
    expect((await invoke(["check-config"])).status).toBe(1);
    chmodSync(env.BEANBAG_LOCAL_ENV_FILE!, 0o600);
    chmodSync(join(directory, "config"), 0o770);
    expect((await invoke(["check-config"])).status).toBe(1);
  });
  it("refuses other Git checkouts and keeps keys outside the data directory", async () => {
    mkdirSync(join(directory, ".git"));
    writeFileSync(join(directory, ".git/HEAD"), "ref: refs/heads/synthetic\n");
    expect((await invoke(["check-config"])).status).toBe(1);
    rmSync(join(directory, ".git"), { recursive: true });
    expect(
      (
        await invoke(["check-config"], {
          ...env,
          BEANBAG_LOCAL_KEY_FILE: join(directory, "data/local.key"),
        })
      ).status,
    ).toBe(1);
  });
  it("locks commands, separates identities/environments and rejects a lost or changed encryption key", () => {
    const store = open();
    expect(() => openLocalStore(config)).toThrow("command.lock");
    close(store);
    for (const change of [
      credentials.replace("sandbox", "production"),
      credentials.replace("0002", "0012"),
      credentials.replace("synthetic-local-client", "different-client"),
    ]) {
      writeFileSync(env.BEANBAG_LOCAL_ENV_FILE!, change);
      expect(() => openLocalStore(loadLocalConfig(project, env))).toThrow(
        "different Plaid settings",
      );
    }
    const key = readFileSync(config.keyFile);
    writeFileSync(
      config.keyFile,
      Buffer.alloc(32, 2).toString("base64") + "\n",
    );
    expect(() => openLocalStore(config)).toThrow("original encryption key");
    unlinkSync(config.keyFile);
    expect(() => openLocalStore(config)).toThrow("original encryption key");
    expect(existsSync(config.keyFile)).toBe(false);
    writeFileSync(config.keyFile, key, { mode: 0o600 });
    close(open());
  });
  it("refuses unsafe database files and existing SQLite sidecar symlinks", () => {
    close(open());
    const database = join(config.stateDirectory, "ledger.sqlite");
    chmodSync(database, 0o644);
    expect(() => openLocalStore(config)).toThrow("owner-only file");
    chmodSync(database, 0o600);
    symlinkSync(config.keyFile, database + "-journal");
    expect(() => openLocalStore(config)).toThrow("symlinks");
  });
  it("runs the bundled CLI without a generated file or a provider connection", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-local.mjs", "check-config"],
      {
        cwd: project,
        env: { PATH: process.env.PATH, ...env },
        encoding: "utf8",
      },
    );
    if (result.error)
      throw new Error(
        "Unable to launch the local CLI subprocess: " +
          (result.error as NodeJS.ErrnoException).code,
      );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no network requests");
    expect(result.stdout + result.stderr).not.toContain(
      "synthetic-local-secret",
    );
    expect(existsSync(config.stateDirectory)).toBe(false);
  });
});

describe("local consent and durable ingestion", () => {
  it("resumes one Hosted Link session, encrypts secrets and persists only the selected pair", async () => {
    const { api, post } = fakeApi();
    let store = open();
    expect(await beginLink(store, api)).toBe(linkUrl);
    expect(await beginLink(store, api)).toBe(linkUrl);
    expect(
      post.mock.calls.filter(([path]) => path === "/link/token/create"),
    ).toHaveLength(1);
    expect(post.mock.calls[0][1]).toMatchObject({
      products: ["transactions", "investments"],
      hosted_link: { is_mobile_app: false },
      enable_multi_item_link: false,
    });
    close(store);
    expect(
      readFileSync(join(config.stateDirectory, "ledger.sqlite")).includes(
        Buffer.from(linkToken),
      ),
    ).toBe(false);
    store = open();
    expect(await completeLink(store, api, config)).toBe("connected");
    expect(await store.repo.accounts()).toHaveLength(2);
    expect(await store.session()).toBeNull();
    const item = (await connection(store))!;
    expect(await decryptToken(item.encrypted_token, store.key, item.id)).toBe(
      accessToken,
    );
    await expect(beginLink(store, api)).rejects.toThrow("already connected");
    close(store);
    const bytes = readFileSync(join(config.stateDirectory, "ledger.sqlite"));
    expect(bytes.includes(Buffer.from(accessToken))).toBe(false);
    for (const path of [
      config.keyFile,
      join(config.stateDirectory, "ledger.sqlite"),
    ])
      expect(statSync(path).mode & 0o077).toBe(0);
  });
  it("keeps pending consent separate from a successful connection and supports legacy results", async () => {
    let finished = false,
      unopened: JsonRecord = {};
    const { api } = fakeApi({
      "/link/token/get": () =>
        finished
          ? {
              link_sessions: [
                {
                  on_success: {
                    public_token: "synthetic-public",
                    metadata: { accounts: accounts.map((a) => ({ id: a.id })) },
                  },
                },
              ],
            }
          : unopened,
    });
    const store = open();
    await beginLink(store, api);
    expect(await completeLink(store, api, config)).toBe("pending");
    unopened = { link_sessions: null };
    expect(await completeLink(store, api, config)).toBe("pending");
    unopened = { link_sessions: [] };
    expect(await completeLink(store, api, config)).toBe("pending");
    expect(await connection(store)).toBeNull();
    finished = true;
    expect(await completeLink(store, api, config)).toBe("connected");
  });
  it("reuses a persisted exchange after an accounts request fails", async () => {
    let fail = true;
    const { api, post } = fakeApi({
      "/accounts/get": () => {
        if (fail) throw new ProviderError("INSTITUTION_DOWN");
        return { accounts: providerAccounts };
      },
    });
    let store = open();
    await beginLink(store, api);
    await expect(completeLink(store, api, config)).rejects.toThrow(
      "INSTITUTION_DOWN",
    );
    close(store);
    store = open();
    fail = false;
    expect(await completeLink(store, api, config)).toBe("connected");
    expect(
      post.mock.calls.filter(
        ([path]) => path === "/item/public_token/exchange",
      ),
    ).toHaveLength(1);
  });
  it("removes a mismatched Item and durably retries failed cleanup", async () => {
    let failRemoval = true;
    const { api, post } = fakeApi({
      "/accounts/get": () => ({
        accounts: [
          providerAccounts[0],
          { ...providerAccounts[1], mask: "9999" },
        ],
      }),
      "/item/remove": () => {
        if (failRemoval) throw new ProviderError("INTERNAL_SERVER_ERROR");
        return {};
      },
    });
    let store = open();
    await beginLink(store, api);
    await expect(completeLink(store, api, config)).rejects.toThrow(
      "cleanup is pending",
    );
    expect(await store.repo.accounts()).toHaveLength(0);
    expect(await connection(store)).toBeNull();
    close(store);
    store = open();
    failRemoval = false;
    expect(await completeLink(store, api, config)).toBe("removed");
    expect(await store.session()).toBeNull();
    expect(
      post.mock.calls.filter(([path]) => path === "/item/remove"),
    ).toHaveLength(2);
  });
  it("rejects multi-Item results and refuses to discard completed consent", async () => {
    const { api } = fakeApi();
    const store = open();
    await beginLink(store, api);
    await expect(cancelLink(store, api)).rejects.toThrow("completed consent");
    const multiple = completed();
    multiple.link_sessions[0].results.item_add_results.push({
      public_token: "another-public",
      accounts: accounts.map((a) => ({ id: a.id })),
    });
    await expect(
      completeLink(
        store,
        fakeApi({ "/link/token/get": () => multiple }).api,
        config,
      ),
    ).rejects.toThrow("More than one Item");
    expect(await connection(store)).toBeNull();
  });
  it("preserves cursors, review decisions and historical values across process-style reopen", async () => {
    const { api } = fakeApi({
      "/transactions/sync": () => ({
        added: [
          rawBank(),
          rawBank({
            account_id: "unselected",
            transaction_id: "ignored-account",
          }),
        ],
        modified: [],
        removed: [],
        has_more: false,
        next_cursor: "persisted-cursor",
      }),
      "/investments/transactions/get": () => ({
        investment_transactions: [rawInvestment()],
        securities: [{ security_id: "test-xyz", ticker_symbol: "XYZ" }],
        total_investment_transactions: 1,
      }),
    });
    let store = open();
    await beginLink(store, api);
    await completeLink(store, api, config);
    const sync = new SyncService(api, store.repo, accessToken);
    await sync.checking();
    await sync.investments("2026-08-01", "2026-08-31");
    const stock = (await store.repo.sources()).find(
      (s) => s.kind === "investment",
    )!;
    await store.repo.saveOverride(
      override({
        eventId: "investment:" + stock.id,
        baseRevision: stock.revision,
        kind: "stock_income",
        valuation: valuation(),
      }),
    );
    close(store);
    store = open();
    expect(await store.repo.cursor("checking")).toBe("persisted-cursor");
    expect(await store.repo.sources()).toHaveLength(2);
    expect(await store.repo.overrides()).toHaveLength(1);
    expect(
      (await store.repo.events()).find((e) => e.kind === "stock_income"),
    ).toMatchObject({ amountCents: 2000000, valuation: { close: "200" } });
    close(store);
    expect((await invoke(["report", "2026-08-01", "2026-08-31"])).status).toBe(
      0,
    );
    const evidencePath = join(config.stateDirectory, "evidence.json");
    const evidence = readFileSync(evidencePath, "utf8");
    expect(JSON.parse(evidence).sources).toHaveLength(2);
    expect(evidence).not.toContain(accessToken);
    expect(evidence).not.toContain("encrypted_token");
    expect(statSync(evidencePath).mode & 0o077).toBe(0);
    const htmlPath = join(config.stateDirectory, "account-values.html");
    const html = readFileSync(htmlPath, "utf8");
    expect(html).toContain("No balance snapshots yet");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("<script");
    expect(html).not.toContain(accessToken);
    expect(statSync(htmlPath).mode & 0o077).toBe(0);
  });
  it("continues the other product after a sync error and prints no provider response", async () => {
    const store = open(),
      { api } = fakeApi();
    await beginLink(store, api);
    await completeLink(store, api, config);
    close(store);
    const paths: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === "/transactions/sync")
        return new Response(
          JSON.stringify({
            error_code: "ITEM_LOGIN_REQUIRED",
            error_message: "private payload",
          }),
          { status: 400 },
        );
      return Response.json({
        investment_transactions: [],
        securities: [],
        total_investment_transactions: 0,
      });
    });
    const result = await invoke(["sync"]);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain("private payload");
    expect(paths).toEqual([
      "/transactions/sync",
      "/investments/transactions/get",
      "/accounts/get",
      "/investments/holdings/get",
    ]);
    expect((await invoke(["status"])).output).toContain("ITEM_LOGIN_REQUIRED");
    const reopened = open();
    expect(await reopened.repo.cursor("checking")).toBeNull();
    expect(
      (await reopened.repo.coverage()).find((c) => c.product === "investments")
        ?.lastSuccess,
    ).not.toBeNull();
  });
});
