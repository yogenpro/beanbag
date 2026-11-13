import { describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "../src/api/app";
import {
  actorFromClaims,
  authenticate,
  localDemo,
  verifyAccessToken,
} from "../src/api/security";
import type { Env } from "../src/api/env";
import { selectAccounts } from "../src/api/onboarding";
import { encryptToken, decryptToken } from "../src/providers/plaid/secrets";
import { verifyWebhook, sha256 } from "../src/providers/plaid/webhook";
import type { PlaidApi, JsonRecord } from "../src/providers/plaid/client";
import { demoLedger } from "../src/data/demo";
import { sqliteD1 } from "./sqlite-d1";

const assets = {
  fetch: async () => new Response("synthetic asset"),
} as unknown as Fetcher;
const env: Env = { ASSETS: assets, LOCAL_DEMO: "true" };
describe("Access and route security", () => {
  it.each([
    "/",
    "/assets/entry.js",
    "/api/report",
    "/api/events/bank:one",
    "/api/admin/link-token",
  ])("protects %s without sign-in, including static assets", async (path) => {
    const app = createApp();
    const response = await app.request(
      "https://private.example.invalid" + path,
      {},
      { ASSETS: assets },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).not.toContain("synthetic asset");
  });
  it("does not trust email headers or a demo flag on an external hostname", async () => {
    await expect(
      authenticate(
        new Request("https://private.example.invalid", {
          headers: {
            "Cf-Access-Authenticated-User-Email": "one@example.invalid",
          },
        }),
        { ASSETS: assets },
      ),
    ).rejects.toThrow();
    expect(localDemo(new Request("https://public.example.invalid"), env)).toBe(
      false,
    );
    expect(
      localDemo(new Request("http://localhost"), {
        ...env,
        PLAID_SECRET: "synthetic",
      }),
    ).toBe(false);
  });
  it("allows either configured identity and denies a third party", () => {
    const settings = {
      ASSETS: assets,
      ALLOWED_EMAILS: "one@example.invalid,two@example.invalid",
      ADMIN_EMAILS: "one@example.invalid",
    };
    expect(
      actorFromClaims({ sub: "one", email: "one@example.invalid" }, settings)
        .admin,
    ).toBe(true);
    expect(
      actorFromClaims({ sub: "two", email: "two@example.invalid" }, settings)
        .admin,
    ).toBe(false);
    expect(() =>
      actorFromClaims(
        { sub: "third", email: "third@example.invalid" },
        settings,
      ),
    ).toThrow("allowlisted");
  });
  it("cryptographically checks issuer, audience, expiry, identity and required claims", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const config = {
      ASSETS: assets,
      ACCESS_ISSUER: "https://test-team.cloudflareaccess.com",
      ACCESS_AUD: "test-audience",
      ALLOWED_EMAILS: "one@example.invalid,two@example.invalid",
    };
    const signed = (patch: Record<string, unknown> = {}) =>
      new SignJWT({ email: "one@example.invalid", ...patch })
        .setProtectedHeader({ alg: "RS256" })
        .setSubject("test-user")
        .setIssuer(config.ACCESS_ISSUER)
        .setAudience(config.ACCESS_AUD)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    expect(
      (await verifyAccessToken(await signed(), config, async () => publicKey))
        .email,
    ).toBe("one@example.invalid");
    expect(
      (
        await verifyAccessToken(
          await signed({ email: "two@example.invalid" }),
          config,
          async () => publicKey,
        )
      ).email,
    ).toBe("two@example.invalid");
    await expect(
      verifyAccessToken(
        await signed({ email: "third@example.invalid" }),
        config,
        async () => publicKey,
      ),
    ).rejects.toThrow();
    await expect(
      verifyAccessToken(
        await signed(),
        { ...config, ACCESS_AUD: "wrong" },
        async () => publicKey,
      ),
    ).rejects.toThrow();
    await expect(
      verifyAccessToken(
        await signed(),
        { ...config, ACCESS_ISSUER: "https://wrong.cloudflareaccess.com" },
        async () => publicKey,
      ),
    ).rejects.toThrow();
    const expired = await new SignJWT({ email: "one@example.invalid" })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("test-user")
      .setIssuer(config.ACCESS_ISSUER)
      .setAudience(config.ACCESS_AUD)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(privateKey);
    await expect(
      verifyAccessToken(expired, config, async () => publicKey),
    ).rejects.toThrow();
    const missingExpiry = await new SignJWT({ email: "one@example.invalid" })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("test-user")
      .setIssuer(config.ACCESS_ISSUER)
      .setAudience(config.ACCESS_AUD)
      .setIssuedAt()
      .sign(privateKey);
    await expect(
      verifyAccessToken(missingExpiry, config, async () => publicKey),
    ).rejects.toThrow();
  });
  it.each([false, true])(
    "rejects dashboard writes without database or provider effects (admin=%s)",
    async (admin) => {
      const { db, sqlite } = sqliteD1();
      const onSyncRequested = vi.fn();
      const app = createApp({
        authenticate: async () => ({
          id: "test-viewer",
          email: "viewer@example.invalid",
          admin,
        }),
        onSyncRequested,
      });
      try {
        const changes = () =>
          sqlite.prepare("SELECT total_changes() AS count").get()!.count;
        const before = changes();
        for (const path of [
          "/api/overrides",
          "/api/review/preview",
          "/api/receipts",
          "/api/sync",
          "/api/admin/link-token",
          "/api/admin/exchange",
          "/api/admin/link-complete",
        ]) {
          const denied = await app.request(
            "https://private.example.invalid" + path,
            {
              method: "POST",
              headers: {
                Origin: "https://private.example.invalid",
                "Content-Type": "application/json",
                "X-Beanbag-Request": "1",
              },
              body: "{}",
            },
            { ASSETS: assets, DB: db },
          );
          expect(denied.status).toBe(405);
          expect(denied.headers.get("Allow")).toBe("GET, HEAD");
          expect(await denied.json()).toEqual({
            error: "This dashboard is read-only",
          });
        }
        for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
          expect(
            (
              await app.request(
                "https://private.example.invalid/api/report",
                { method },
                { ASSETS: assets, DB: db },
              )
            ).status,
          ).toBe(405);
        }
        expect(changes()).toBe(before);
        expect(onSyncRequested).not.toHaveBeenCalled();
        const read = await app.request(
          "https://private.example.invalid/api/report",
          {},
          { ASSETS: assets, DB: db },
        );
        expect(read.status).toBe(200);
        expect(changes()).toBe(before);
        expect(read.headers.get("Content-Security-Policy")).not.toContain(
          "plaid.com",
        );
      } finally {
        sqlite.close();
      }
    },
  );
  it("always labels demo data and never enables onboarding in demo mode", async () => {
    const app = createApp({ demo: demoLedger() });
    const response = await app.request("http://localhost/api/report", {}, env);
    expect(
      ((await response.json()) as { illustrative: boolean }).illustrative,
    ).toBe(true);
    expect(
      (
        await app.request(
          "http://localhost/api/admin/link-token",
          {
            method: "POST",
            headers: {
              Origin: "http://localhost",
              "Content-Type": "application/json",
              "X-Beanbag-Request": "1",
            },
            body: "{}",
          },
          env,
        )
      ).status,
    ).toBe(405);
    expect(
      (await app.request("http://localhost/api/missing", {}, env)).status,
    ).toBe(404);
  });
  it("does not permit the webhook exception to bypass other routes", async () => {
    const app = createApp();
    expect(
      (
        await app.request(
          "https://private.example.invalid/webhooks/plaid",
          { method: "POST", body: "{}" },
          { ASSETS: assets },
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await app.request(
          "https://private.example.invalid/webhooks/plaid/extra",
          { method: "POST", body: "{}" },
          { ASSETS: assets },
        )
      ).status,
    ).toBe(401);
  });
});
describe("fresh account allowlist", () => {
  const available = [
    {
      account_id: "fresh-checking",
      mask: "0001",
      type: "depository",
      subtype: "checking",
    },
    {
      account_id: "fresh-brokerage",
      mask: "0002",
      type: "investment",
      subtype: "brokerage",
    },
    { account_id: "unselected-personal", mask: "0003", type: "investment" },
  ];
  it("discovers fresh provider IDs and stores exactly the two selected accounts", () => {
    expect(
      selectAccounts(
        available,
        ["fresh-checking", "fresh-brokerage"],
        "0001",
        "0002",
      ).map((a) => a.id),
    ).toEqual(["fresh-checking", "fresh-brokerage"]);
    expect(() =>
      selectAccounts(
        available,
        ["fresh-checking", "unselected-personal"],
        "0001",
        "0002",
      ),
    ).toThrow();
    expect(() =>
      selectAccounts(
        [...available, available[0]],
        ["fresh-checking", "fresh-brokerage"],
        "0001",
        "0002",
      ),
    ).toThrow();
    expect(() =>
      selectAccounts(
        available,
        ["fresh-checking", "fresh-brokerage", "unselected-personal"],
        "0001",
        "0002",
      ),
    ).toThrow();
  });
});
describe("encrypted Plaid token registry", () => {
  it("round-trips a token, binds ciphertext to the Item, and rejects tampering", async () => {
    const secret = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    );
    const encrypted = await encryptToken(
      "synthetic-access-value",
      secret,
      "test-item",
    );
    expect(encrypted).not.toContain("synthetic-access-value");
    expect(await decryptToken(encrypted, secret, "test-item")).toBe(
      "synthetic-access-value",
    );
    await expect(
      decryptToken(encrypted, secret, "different-item"),
    ).rejects.toThrow();
    await expect(
      decryptToken(encrypted.slice(0, -5) + "AAAAA", secret, "test-item"),
    ).rejects.toThrow();
  });
});
describe("cryptographic webhook verification", () => {
  it("accepts an authentic body and rejects tampering, stale timestamps and wrong algorithms", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256"),
      jwk = {
        ...(await exportJWK(publicKey)),
        kid: "test-key",
        alg: "ES256",
        expired_at: null,
      };
    const api: PlaidApi = {
      post: async <T extends JsonRecord>() => ({ key: jwk }) as unknown as T,
    };
    const raw = '{"item_id":"synthetic-item","webhook_type":"TRANSACTIONS"}',
      now = new Date();
    const token = await new SignJWT({ request_body_sha256: await sha256(raw) })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .sign(privateKey);
    expect(await verifyWebhook(raw, token, api, now)).toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyWebhook(raw + " ", token, api, now)).rejects.toThrow(
      "hash",
    );
    await expect(
      verifyWebhook(raw, token, api, new Date(now.getTime() + 301000)),
    ).rejects.toThrow();
    const futureToken = await new SignJWT({
      request_body_sha256: await sha256(raw),
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt(Math.floor(now.getTime() / 1000) + 60)
      .sign(privateKey);
    await expect(verifyWebhook(raw, futureToken, api, now)).rejects.toThrow();
    const hmac = await new SignJWT({ request_body_sha256: await sha256(raw) })
      .setProtectedHeader({ alg: "HS256", kid: "test-key" })
      .setIssuedAt()
      .sign(crypto.getRandomValues(new Uint8Array(32)));
    await expect(verifyWebhook(raw, hmac, api)).rejects.toThrow("key");
  });
});
