import { createApp, plaid } from "./api/app";
import type { Env } from "./api/env";
import { D1Ledger } from "./data/d1";
import { decryptToken } from "./providers/plaid/secrets";
import { SyncService } from "./providers/plaid/sync";

export async function runSync(env: Env, scheduled = false): Promise<void> {
  if (!env.DB || !env.TOKEN_ENCRYPTION_KEY || env.LOCAL_DEMO === "true") return;
  const connection = await env.DB.prepare(
    "SELECT id,encrypted_token,status FROM plaid_connections LIMIT 1",
  ).first<{ id: string; encrypted_token: string; status: string }>();
  if (!connection || connection.status !== "connected") return;
  const token = await decryptToken(
    connection.encrypted_token,
    env.TOKEN_ENCRYPTION_KEY,
    connection.id,
  );
  const sync = new SyncService(plaid(env), new D1Ledger(env.DB), token);
  const products = scheduled
    ? ["checking", "investments"]
    : (
        await env.DB.prepare(
          "SELECT product FROM sync_jobs ORDER BY requested_at",
        ).all<{ product: string }>()
      ).results.map((r) => r.product);
  for (const product of products) {
    try {
      if (product === "checking") await sync.checking();
      else if (product === "investments") await sync.investments();
    } catch {
      /* Sync service records a safe code in data health. Never log financial payloads. */
    }
  }
}
const app = createApp({ onSyncRequested: (env) => runSync(env) });
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env, true));
  },
} satisfies ExportedHandler<Env>;
