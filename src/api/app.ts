import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { assertPeriod, periodFor } from "../accounting/dates";
import { report } from "../accounting/report";
import { balanceReport } from "../accounting/balances";
import { eventId } from "../accounting/types";
import { D1Ledger } from "../data/d1";
import { demoLedger } from "../data/demo";
import { PlaidClient, ProviderError } from "../providers/plaid/client";
import { verifyWebhook } from "../providers/plaid/webhook";
import { authenticate, localDemo } from "./security";
import type { Actor, AppContext, Env } from "./env";
import type { LedgerRepository } from "../data/repository";

export function plaid(env: Env): PlaidClient {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET || !env.PLAID_ENV)
    throw new ProviderError("PLAID_SETUP_REQUIRED");
  return new PlaidClient(env.PLAID_CLIENT_ID, env.PLAID_SECRET, env.PLAID_ENV);
}
type Options = {
  authenticate?: (request: Request, env: Env) => Promise<Actor>;
  demo?: LedgerRepository;
  onSyncRequested?: (env: Env) => Promise<void>;
};
export function createApp(options: Options = {}) {
  const app = new Hono<AppContext>();
  let illustration: LedgerRepository | undefined = options.demo;
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: "Request too large" }, 413),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: "Check the submitted fields",
          fields: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    if (error instanceof ProviderError)
      return c.json({ error: error.code }, 502);
    return c.json(
      {
        error: "Unable to load this view. Try again or check Data health.",
      },
      400,
    );
  });
  // The only Access exception. No other URL bypasses application authentication.
  app.post("/webhooks/plaid", async (c) => {
    if (!c.env.DB || !c.env.PLAID_SECRET || c.env.LOCAL_DEMO === "true")
      return c.json({ error: "Webhook unavailable" }, 503);
    const raw = await c.req.text(),
      token = c.req.header("Plaid-Verification");
    if (!token) return c.json({ error: "Signature required" }, 401);
    let digest: string;
    try {
      digest = await verifyWebhook(raw, token, plaid(c.env));
    } catch {
      return c.json({ error: "Invalid webhook signature" }, 401);
    }
    const payload = z
      .object({
        item_id: z.string(),
        webhook_type: z.string(),
        webhook_code: z.string(),
      })
      .parse(JSON.parse(raw));
    if (
      !(await c.env.DB.prepare("SELECT id FROM plaid_connections WHERE id=?")
        .bind(payload.item_id)
        .first())
    )
      return c.json({ received: true }, 202);
    const now = new Date().toISOString();
    const inserted = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO webhook_receipts(digest,received_at,expires_at) VALUES (?,?,?)",
    )
      .bind(digest, now, new Date(Date.now() + 10 * 60_000).toISOString())
      .run();
    if (inserted.meta.changes !== 1)
      return c.json({ received: true, duplicate: true }, 202);
    const product =
      payload.webhook_type === "TRANSACTIONS" &&
      payload.webhook_code === "SYNC_UPDATES_AVAILABLE"
        ? "checking"
        : ["INVESTMENTS_TRANSACTIONS", "HOLDINGS"].includes(
              payload.webhook_type,
            ) &&
            ["DEFAULT_UPDATE", "HISTORICAL_UPDATE"].includes(
              payload.webhook_code,
            )
          ? "investments"
          : null;
    if (
      payload.webhook_type === "ITEM" &&
      ["ERROR", "PENDING_EXPIRATION", "USER_PERMISSION_REVOKED"].includes(
        payload.webhook_code,
      )
    ) {
      await c.env.DB.prepare("UPDATE plaid_connections SET status=? WHERE id=?")
        .bind(payload.webhook_code, payload.item_id)
        .run();
    }
    if (product) {
      await c.env.DB.prepare(
        "INSERT INTO sync_jobs(id,product,requested_at) VALUES (?,?,?) ON CONFLICT(product) DO UPDATE SET requested_at=excluded.requested_at",
      )
        .bind(crypto.randomUUID(), product, now)
        .run();
      if (options.onSyncRequested)
        c.executionCtx.waitUntil(options.onSyncRequested(c.env));
    }
    await c.env.DB.prepare("DELETE FROM webhook_receipts WHERE expires_at < ?")
      .bind(now)
      .run();
    return c.json({ received: true }, 202);
  });
  app.use("*", async (c, next) => {
    try {
      c.set(
        "actor",
        await (options.authenticate ?? authenticate)(c.req.raw, c.env),
      );
    } catch {
      return c.json(
        { error: "An allowlisted Cloudflare Access sign-in is required" },
        401,
      );
    }
    const demo = localDemo(c.req.raw, c.env);
    c.set("demo", demo);
    if (demo) {
      illustration ??= demoLedger();
      c.set("ledger", illustration);
    } else if (c.env.DB) c.set("ledger", new D1Ledger(c.env.DB));
    else
      return c.json(
        { error: "Private database binding is not configured" },
        503,
      );
    await next();
  });
  // The dashboard is read-only for every signed-in identity, including administrators.
  // Provider ingestion uses the separately authenticated webhook and scheduled worker.
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD"].includes(c.req.method)) {
      c.header("Allow", "GET, HEAD");
      return c.json({ error: "This dashboard is read-only" }, 405);
    }
    await next();
  });
  app.get("/api/report", async (c) => {
    const preset = periodFor("month");
    const period = assertPeriod({
      start: c.req.query("start") ?? preset.start,
      end: c.req.query("end") ?? preset.end,
    });
    const repo = c.get("ledger");
    const [events, accounts, coverage, snapshots, balanceHealth, historical] =
      await Promise.all([
        repo.events(),
        repo.accounts(),
        repo.coverage(),
        repo.balanceSnapshots(),
        repo.balanceHealth(),
        repo.accountValueHistory(),
      ]);
    const connection =
      !c.get("demo") && c.env.DB
        ? await c.env.DB.prepare(
            "SELECT status FROM plaid_connections LIMIT 1",
          ).first<{ status: string }>()
        : null;
    return c.json({
      ...report(events, period),
      trend: report(events, {
        start: period.start.slice(0, 4) + "-01-01",
        end: period.end,
      }).months,
      accounts,
      balances: balanceReport(
        snapshots,
        accounts,
        balanceHealth,
        period,
        new Date(),
        historical,
      ),
      coverage,
      illustrative: c.get("demo"),
      connectionStatus: c.get("demo")
        ? "illustrative"
        : (connection?.status ?? "not_connected"),
    });
  });
  app.get("/api/events/:id", async (c) => {
    const repo = c.get("ledger"),
      id = c.req.param("id");
    const source = (await repo.sources()).find((s) => eventId(s) === id);
    if (!source) return c.json({ error: "Record not found" }, 404);
    return c.json({
      source,
      event: (await repo.events()).find((e) => e.id === id),
      history: (await repo.overrides()).filter((o) => o.eventId === id),
    });
  });
  app.all("/api/*", (c) => c.json({ error: "API route not found" }, 404));
  app.all("/webhooks/*", (c) =>
    c.json({ error: "Webhook route not found" }, 404),
  );
  app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
