import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import type { MiddlewareHandler } from "hono";
import type { Actor, AppContext, Env } from "./env";

const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const list = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
export function localDemo(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  // Wrangler supplies simulated request.cf too; the immutable request URL and
  // explicit credential-free local environment define the preview boundary.
  return (
    env.LOCAL_DEMO === "true" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    !env.PLAID_SECRET &&
    !env.PLAID_CLIENT_ID &&
    !env.ACCESS_AUD &&
    !env.ACCESS_ISSUER &&
    !env.APP_ORIGIN
  );
}
export function actorFromClaims(payload: JWTPayload, env: Env): Actor {
  if (
    typeof payload.email !== "string" ||
    typeof payload.sub !== "string" ||
    !list(env.ALLOWED_EMAILS).includes(payload.email.toLowerCase())
  )
    throw new Error("Identity is not allowlisted");
  return {
    id: payload.sub,
    email: payload.email,
    admin: list(env.ADMIN_EMAILS).includes(payload.email.toLowerCase()),
  };
}
export async function authenticate(request: Request, env: Env): Promise<Actor> {
  if (localDemo(request, env))
    return {
      id: "illustrative-user",
      email: "demo@example.invalid",
      admin: true,
    };
  if (
    env.LOCAL_DEMO === "true" ||
    !env.ACCESS_ISSUER ||
    !env.ACCESS_AUD ||
    !env.APP_ORIGIN ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER)
  )
    throw new Error("Access is not configured");
  if (new URL(request.url).origin !== env.APP_ORIGIN)
    throw new Error("Unexpected application origin");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Error("Sign in through Cloudflare Access");
  let jwks = keys.get(env.ACCESS_ISSUER);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(env.ACCESS_ISSUER + "/cdn-cgi/access/certs"),
    );
    keys.set(env.ACCESS_ISSUER, jwks);
  }
  return verifyAccessToken(token, env, jwks);
}
export async function verifyAccessToken(
  token: string,
  env: Env,
  key: JWTVerifyGetKey,
): Promise<Actor> {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD)
    throw new Error("Missing Access configuration");
  const { payload } = await jwtVerify(token, key, {
    issuer: env.ACCESS_ISSUER,
    audience: env.ACCESS_AUD,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "email"],
  });
  return actorFromClaims(payload, env);
}
export const mutationGuard: MiddlewareHandler<AppContext> = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const expected = c.get("demo") ? new URL(c.req.url).origin : c.env.APP_ORIGIN;
  if (
    !expected ||
    c.req.header("Origin") !== expected ||
    c.req.header("X-Beanbag-Request") !== "1" ||
    !c.req.header("Content-Type")?.startsWith("application/json")
  )
    return c.json({ error: "Same-origin JSON request required" }, 403);
  if (!c.get("demo") && c.env.DB) {
    const identity = c.get("actor").id,
      window = Math.floor(Date.now() / 60_000);
    const row = await c.env.DB.prepare(
      `INSERT INTO mutation_limits(identity,window,hits) VALUES(?,?,1)
      ON CONFLICT(identity) DO UPDATE SET window=excluded.window, hits=CASE WHEN mutation_limits.window=excluded.window THEN mutation_limits.hits+1 ELSE 1 END RETURNING hits`,
    )
      .bind(identity, window)
      .first<{ hits: number }>();
    if (!row || row.hits > 20)
      return c.json({ error: "Please wait a minute before trying again" }, 429);
  }
  await next();
};
