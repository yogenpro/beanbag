import { selectAccounts } from "../api/onboarding";
import { encryptToken } from "../providers/plaid/secrets";
import type { JsonRecord, PlaidApi } from "../providers/plaid/client";
import type { LocalConfig } from "./config";
import { LocalError } from "./files";
import type { LinkState, LocalStore } from "./store";

export async function connection(store: LocalStore) {
  return store.db
    .prepare(
      "SELECT id, encrypted_token, status FROM plaid_connections LIMIT 1",
    )
    .first<{ id: string; encrypted_token: string; status: string }>();
}

function providerText(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2000)
    throw new LocalError(
      "Plaid returned an incomplete Link response. No provider payload was printed.",
    );
  return value;
}

export async function beginLink(
  store: LocalStore,
  api: PlaidApi,
): Promise<string> {
  if (await connection(store))
    throw new LocalError(
      "This local ledger is already connected. Local update-mode repair is not implemented; use private operator recovery for this Item.",
    );
  const pending = await store.session();
  if (pending) {
    if (pending.exchange)
      throw new LocalError(
        "A previous Link exchange is pending. Run complete-link to finish it or retry cleanup.",
      );
    if (Date.parse(pending.expiration) > Date.now()) return pending.url;
    throw new LocalError(
      "The saved Link session expired. Run complete-link to check for completed consent, or cancel-link before creating a new session.",
    );
  }
  const result = await api.post("/link/token/create", {
    client_name: "Beanbag local integration",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: store.actor },
    products: ["transactions", "investments"],
    account_filters: {
      depository: { account_subtypes: ["checking"] },
      investment: { account_subtypes: ["all"] },
    },
    enable_multi_item_link: false,
    hosted_link: { is_mobile_app: false, url_lifetime_seconds: 1800 },
  });
  const linkToken = providerText(result.link_token),
    url = providerText(result.hosted_link_url),
    expiration = providerText(result.expiration);
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "secure.plaid.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    !parsed.pathname.startsWith("/hl/") ||
    !(Date.parse(expiration) > Date.now())
  )
    throw new LocalError(
      "Plaid returned an unexpected Hosted Link destination or expiration.",
    );
  await store.saveSession({ linkToken, url, expiration });
  return url;
}

/** The results shape is preferred; the documented legacy shape is a fallback. */
function completedItem(
  payload: JsonRecord,
): { publicToken: string; selectedIds: string[] } | null {
  // Before the owner opens Hosted Link, Sandbox can omit this field entirely.
  if (payload.link_sessions == null) return null;
  if (!Array.isArray(payload.link_sessions))
    throw new LocalError("Plaid returned an invalid Link session result.");
  const completed = new Map<
    string,
    { publicToken: string; selectedIds: string[] }
  >();
  for (const session of payload.link_sessions) {
    const results = session.results?.item_add_results;
    const items =
      Array.isArray(results) && results.length
        ? results
        : session.on_success
          ? [
              {
                public_token: session.on_success.public_token,
                accounts: session.on_success.metadata?.accounts,
              },
            ]
          : [];
    for (const item of items) {
      const publicToken = providerText(item.public_token);
      if (!Array.isArray(item.accounts))
        throw new LocalError(
          "Plaid did not return the selected accounts for this Link session.",
        );
      const selectedIds = item.accounts.map((account: JsonRecord) =>
        providerText(account.id),
      );
      completed.set(publicToken, { publicToken, selectedIds });
    }
  }
  if (completed.size > 1)
    throw new LocalError(
      "More than one Item was authorized. Reconcile the Items privately in Plaid before continuing; no account boundary was saved.",
    );
  return [...completed.values()][0] ?? null;
}

async function cleanup(
  store: LocalStore,
  api: PlaidApi,
  session: LinkState,
): Promise<void> {
  if (!session.exchange)
    throw new LocalError("No exchanged Item is available for cleanup.");
  session.cleanup = true;
  await store.saveSession(session);
  try {
    await api.post("/item/remove", { access_token: session.exchange.token });
  } catch {
    throw new LocalError(
      "Item cleanup is pending. Run complete-link to retry. The encrypted token is retained privately until removal succeeds.",
    );
  }
  store.clearSession();
}

export async function completeLink(
  store: LocalStore,
  api: PlaidApi,
  config: LocalConfig,
): Promise<"connected" | "pending" | "removed"> {
  if (await connection(store)) return "connected";
  const session = await store.session();
  if (!session)
    throw new LocalError("Start a local Link session with connect first.");
  if (session.cleanup) {
    await cleanup(store, api, session);
    return "removed";
  }
  if (!session.exchange) {
    const response = await api.post("/link/token/get", {
      link_token: session.linkToken,
    });
    const completed = completedItem(response);
    if (!completed) return "pending";
    const result = await api.post("/item/public_token/exchange", {
      public_token: completed.publicToken,
    });
    session.exchange = {
      itemId: providerText(result.item_id),
      token: providerText(result.access_token),
      selectedIds: completed.selectedIds,
    };
    // A one-time public token must never be exchanged again after a later failure.
    try {
      await store.saveSession(session);
    } catch {
      try {
        await api.post("/item/remove", {
          access_token: session.exchange.token,
        });
      } catch {
        throw new LocalError(
          "Unable to persist or remove the newly authorized Item. Revoke this connection in Plaid before retrying.",
        );
      }
      store.clearSession();
      throw new LocalError(
        "Unable to persist the Link exchange. The new Item was removed; check private storage before retrying.",
      );
    }
  }
  const { itemId, token, selectedIds } = session.exchange;
  const available = await api.post("/accounts/get", { access_token: token });
  if (!Array.isArray(available.accounts))
    throw new LocalError(
      "Plaid returned an invalid accounts response; retry complete-link.",
    );
  let accounts;
  try {
    accounts = selectAccounts(
      available.accounts,
      selectedIds,
      config.checkingMask,
      config.brokerageMask,
    );
  } catch {
    await cleanup(store, api, session);
    throw new LocalError(
      "The selected accounts did not match the private checking/brokerage boundary. The new Item was removed. Check the private masks and reconnect.",
    );
  }
  const encrypted = await encryptToken(token, store.key, itemId);
  await store.db.batch([
    store.db
      .prepare(
        "INSERT INTO plaid_connections(id,encrypted_token,status,created_at) VALUES(?,?,?,?)",
      )
      .bind(itemId, encrypted, "connected", new Date().toISOString()),
    ...accounts.map((account) =>
      store.db
        .prepare("INSERT INTO accounts(id,role,label,mask) VALUES(?,?,?,?)")
        .bind(account.id, account.role, account.label, account.mask),
    ),
    store.db.prepare("UPDATE ledger_meta SET revision=revision+1 WHERE id=1"),
    store.db.prepare("DELETE FROM local_link"),
  ]);
  return "connected";
}

export async function cancelLink(
  store: LocalStore,
  api: PlaidApi,
): Promise<void> {
  if (await connection(store))
    throw new LocalError(
      "cancel-link does not disconnect an established Item.",
    );
  const session = await store.session();
  if (!session) return;
  if (session.exchange) {
    await cleanup(store, api, session);
    return;
  }
  // Do not discard a completed consent and leave a provider Item orphaned.
  const response = await api.post("/link/token/get", {
    link_token: session.linkToken,
  });
  if (completedItem(response))
    throw new LocalError(
      "This session has completed consent. Run complete-link before changing the connection.",
    );
  store.clearSession();
}
