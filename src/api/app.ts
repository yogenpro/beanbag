import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { classify } from "../accounting/classify";
import { assertPeriod, periodFor, validDate } from "../accounting/dates";
import { report } from "../accounting/report";
import { eventId, type Override } from "../accounting/types";
import { D1Ledger, ConflictError } from "../data/d1";
import { demoLedger } from "../data/demo";
import { PlaidClient, ProviderError } from "../providers/plaid/client";
import { encryptToken } from "../providers/plaid/secrets";
import { withRevision } from "../providers/plaid/normalize";
import { verifyWebhook } from "../providers/plaid/webhook";
import { authenticate, localDemo, mutationGuard } from "./security";
import { selectAccounts } from "./onboarding";
import type { Actor, AppContext, Env } from "./env";
import type { LedgerRepository } from "../data/repository";
import { reclassify } from "../data/repository";

const date = z.string().refine(validDate, "Use a valid calendar date");
const decimal = z
  .string()
  .regex(/^\d+(?:\.\d{1,24})?$/)
  .max(60);
const valuationSchema = z.object({
  securityId: z.string().min(1).max(150),
  quantity: decimal,
  eventDate: date,
  close: decimal,
  priceDate: date,
  currency: z.literal("USD"),
  provider: z.string().trim().min(3).max(200),
  retrievedAt: z.iso.datetime(),
  convention: z.literal("last_session_close"),
});
const overrideSchema = z.object({
  eventId: z.string().min(1).max(250),
  baseRevision: z.string().min(1).max(100),
  kind: z.enum([
    "cash_income",
    "stock_income",
    "spending",
    "internal_transfer",
    "ignored",
    "unknown",
  ]),
  date: date.optional(),
  valuation: valuationSchema.optional(),
  rationale: z.string().trim().min(5).max(1000),
});
const receiptSchema = z.object({
  reference: z.string().regex(/^[a-zA-Z0-9_.:-]{3,120}$/),
  providerTransactionId: z.string().min(3).max(150).optional(),
  date,
  securityId: z.string().min(1).max(150),
  ticker: z.string().regex(/^[A-Z0-9.:-]{1,20}$/),
  quantity: decimal,
  close: decimal,
  priceDate: date,
  priceSource: z.string().trim().min(3).max(200),
  rationale: z.string().trim().min(10).max(1000),
});

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
      "default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
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
    if (error instanceof ConflictError)
      return c.json(
        { error: "The record changed. Reload and review again." },
        409,
      );
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
        error:
          "Unable to complete this request. Check data health or the submitted evidence.",
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
  app.use("/api/*", mutationGuard);
  app.get("/api/report", async (c) => {
    const preset = periodFor("month");
    const period = assertPeriod({
      start: c.req.query("start") ?? preset.start,
      end: c.req.query("end") ?? preset.end,
    });
    const repo = c.get("ledger");
    const [events, accounts, coverage] = await Promise.all([
      repo.events(),
      repo.accounts(),
      repo.coverage(),
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
      coverage,
      illustrative: c.get("demo"),
      actor: { admin: c.get("actor").admin },
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
  app.post("/api/review/preview", async (c) => {
    const input = overrideSchema.parse(await c.req.json()),
      repo = c.get("ledger");
    const source = (await repo.sources()).find(
      (s) => eventId(s) === input.eventId,
    );
    if (!source || source.revision !== input.baseRevision)
      throw new ConflictError();
    const override: Override = {
      ...input,
      id: "preview",
      actor: c.get("actor").id,
      createdAt: new Date().toISOString(),
    };
    const event = reclassify(
      await repo.sources(),
      await repo.accounts(),
      [...(await repo.overrides()), override],
      await repo.valuations(),
    ).find((e) => e.id === override.eventId)!;
    const before = (await repo.events()).find((e) => e.id === input.eventId)!;
    return c.json({
      before,
      after: event,
      changes: {
        previousKind: before.kind,
        nextKind: event.kind,
        previousConfirmedCents:
          before.status === "confirmed" ? before.amountCents : 0,
        nextConfirmedCents:
          event.status === "confirmed" ? event.amountCents : 0,
      },
    });
  });
  app.post("/api/overrides", async (c) => {
    const input = overrideSchema.parse(await c.req.json());
    const event = await c
      .get("ledger")
      .saveOverride({
        ...input,
        id: crypto.randomUUID(),
        actor: c.get("actor").id,
        createdAt: new Date().toISOString(),
      });
    return c.json({ event }, 201);
  });
  app.post("/api/receipts", async (c) => {
    const input = receiptSchema.parse(await c.req.json()),
      repo = c.get("ledger");
    const account = (await repo.accounts()).find(
      (a) => a.role === "joint_brokerage",
    );
    if (!account)
      return c.json({ error: "Select the brokerage account first" }, 409);
    const source = await withRevision({
      kind: "investment" as const,
      id: input.providerTransactionId ?? `manual:${input.reference}`,
      accountId: account.id,
      date: input.date,
      description: `${input.ticker} · Reviewed external share receipt`,
      currency: "USD",
      activity: "transfer",
      securityId: input.securityId,
      ticker: input.ticker,
      quantity: input.quantity,
      cashAmountCents: 0,
      direction: "in" as const,
      origin: "external" as const,
      evidence: input.rationale,
      manual: true,
    });
    const now = new Date().toISOString();
    const valuation = valuationSchema.parse({
      securityId: input.securityId,
      quantity: input.quantity,
      eventDate: input.date,
      close: input.close,
      priceDate: input.priceDate,
      currency: "USD",
      provider: input.priceSource,
      retrievedAt: now,
      convention: "last_session_close",
    });
    const override: Override = {
      id: crypto.randomUUID(),
      eventId: eventId(source),
      baseRevision: source.revision,
      kind: "stock_income",
      valuation,
      rationale: input.rationale,
      actor: c.get("actor").id,
      createdAt: now,
    };
    await repo.saveManual(
      {
        record: source,
        raw: JSON.stringify({ manuallyProvidedEvidence: input }),
      },
      override,
    );
    return c.json({ id: eventId(source) }, 201);
  });
  app.post("/api/sync", async (c) => {
    if (c.get("demo"))
      return c.json({
        illustrative: true,
        message: "Illustrative records do not connect to a bank",
      });
    const now = new Date().toISOString();
    await c.env.DB!.batch(
      (["checking", "investments"] as const).map((product) =>
        c.env
          .DB!.prepare(
            "INSERT INTO sync_jobs(id,product,requested_at) VALUES (?,?,?) ON CONFLICT(product) DO UPDATE SET requested_at=excluded.requested_at",
          )
          .bind(crypto.randomUUID(), product, now),
      ),
    );
    if (options.onSyncRequested)
      c.executionCtx.waitUntil(options.onSyncRequested(c.env));
    return c.json({ queued: true }, 202);
  });
  app.use("/api/admin/*", async (c, next) => {
    if (!c.get("actor").admin || c.get("demo"))
      return c.json({ error: "Private administrator setup required" }, 403);
    await next();
  });
  app.post("/api/admin/link-token", async (c) => {
    const existing = await c.env
      .DB!.prepare("SELECT id,encrypted_token FROM plaid_connections LIMIT 1")
      .first<{ id: string; encrypted_token: string }>();
    const request: Record<string, unknown> = {
      client_name: "Beanbag",
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: c.get("actor").id },
    };
    if (c.env.PLAID_WEBHOOK_URL) request.webhook = c.env.PLAID_WEBHOOK_URL;
    if (c.env.PLAID_REDIRECT_URI)
      request.redirect_uri = c.env.PLAID_REDIRECT_URI;
    if (existing) {
      const { decryptToken } = await import("../providers/plaid/secrets");
      if (!c.env.TOKEN_ENCRYPTION_KEY)
        throw new Error("Missing encryption key");
      request.access_token = await decryptToken(
        existing.encrypted_token,
        c.env.TOKEN_ENCRYPTION_KEY,
        existing.id,
      );
    } else {
      request.products = ["transactions", "investments"];
      request.account_filters = {
        depository: { account_subtypes: ["checking"] },
        investment: { account_subtypes: ["all"] },
      };
    }
    const result = await plaid(c.env).post("/link/token/create", request);
    return c.json({ linkToken: result.link_token, updateMode: !!existing });
  });
  app.post("/api/admin/exchange", async (c) => {
    const input = z
      .object({
        publicToken: z.string().min(10).max(300),
        selectedAccountIds: z.array(z.string()).length(2),
      })
      .parse(await c.req.json());
    if (
      !c.env.TOKEN_ENCRYPTION_KEY ||
      !c.env.CHECKING_ACCOUNT_MASK ||
      !c.env.BROKERAGE_ACCOUNT_MASK
    )
      throw new Error("Private account configuration is incomplete");
    if (
      await c.env
        .DB!.prepare("SELECT id FROM plaid_connections LIMIT 1")
        .first()
    )
      return c.json(
        { error: "An Item already exists. Use the update Link flow." },
        409,
      );
    const client = plaid(c.env),
      result = await client.post("/item/public_token/exchange", {
        public_token: input.publicToken,
      });
    let saved = false;
    try {
      const available = await client.post("/accounts/get", {
        access_token: result.access_token,
      });
      const accounts = selectAccounts(
        available.accounts,
        input.selectedAccountIds,
        c.env.CHECKING_ACCOUNT_MASK,
        c.env.BROKERAGE_ACCOUNT_MASK,
      );
      const encrypted = await encryptToken(
        result.access_token,
        c.env.TOKEN_ENCRYPTION_KEY,
        result.item_id,
      );
      await c.env.DB!.batch([
        c.env
          .DB!.prepare(
            "INSERT INTO plaid_connections(id,encrypted_token,status,created_at) VALUES (?,?,?,?)",
          )
          .bind(
            result.item_id,
            encrypted,
            "connected",
            new Date().toISOString(),
          ),
        ...accounts.map((a) =>
          c.env
            .DB!.prepare(
              "INSERT INTO accounts(id,role,label,mask) VALUES (?,?,?,?)",
            )
            .bind(a.id, a.role, a.label, a.mask),
        ),
        c.env.DB!.prepare(
          "UPDATE ledger_meta SET revision=revision+1 WHERE id=1",
        ),
      ]);
      saved = true;
      return c.json(
        {
          connected: true,
          accounts: accounts.map((a) => ({ label: a.label, role: a.role })),
        },
        201,
      );
    } finally {
      if (!saved) {
        try {
          await client.post("/item/remove", {
            access_token: result.access_token,
          });
        } catch {
          /* No token or provider payload in logs. */
        }
      }
    }
  });
  app.post("/api/admin/link-complete", async (c) => {
    const connection = await c.env
      .DB!.prepare("SELECT id,encrypted_token FROM plaid_connections LIMIT 1")
      .first<{ id: string; encrypted_token: string }>();
    if (!connection || !c.env.TOKEN_ENCRYPTION_KEY)
      return c.json({ error: "No Item to update" }, 409);
    const { decryptToken } = await import("../providers/plaid/secrets");
    const accessToken = await decryptToken(
      connection.encrypted_token,
      c.env.TOKEN_ENCRYPTION_KEY,
      connection.id,
    );
    const available = await plaid(c.env).post("/accounts/get", {
      access_token: accessToken,
    });
    const selected = await c.get("ledger").accounts();
    if (
      !selected.every((a) =>
        available.accounts.some(
          (p: any) => p.account_id === a.id && p.mask === a.mask,
        ),
      )
    )
      return c.json(
        {
          error:
            "Selected account IDs changed. Administrator reconciliation is required.",
        },
        409,
      );
    await c.env
      .DB!.prepare("UPDATE plaid_connections SET status='connected' WHERE id=?")
      .bind(connection.id)
      .run();
    return c.json({ connected: true });
  });
  app.all("/api/*", (c) => c.json({ error: "API route not found" }, 404));
  app.all("/webhooks/*", (c) =>
    c.json({ error: "Webhook route not found" }, 404),
  );
  app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
