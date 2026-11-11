import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { revisionOf } from "./normalize";
import type { PlaidApi } from "./client";

export async function sha256(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function verifyWebhook(
  raw: string,
  token: string,
  api: PlaidApi,
  now = new Date(),
): Promise<string> {
  const header = decodeProtectedHeader(token);
  if (
    header.alg !== "ES256" ||
    typeof header.kid !== "string" ||
    header.kid.length > 128
  )
    throw new Error("Invalid webhook key");
  const response = await api.post("/webhook_verification_key/get", {
    key_id: header.kid,
  });
  const jwk = response.key as JWK & { expired_at?: unknown };
  if (
    !jwk ||
    jwk.alg !== "ES256" ||
    jwk.kid !== header.kid ||
    jwk.expired_at != null
  )
    throw new Error("Expired or mismatched webhook key");
  const { payload } = await jwtVerify(token, await importJWK(jwk, "ES256"), {
    algorithms: ["ES256"],
    maxTokenAge: "5m",
    clockTolerance: 0,
    currentDate: now,
  });
  if (
    typeof payload.iat !== "number" ||
    payload.iat > now.getTime() / 1000 + 5 ||
    typeof payload.request_body_sha256 !== "string"
  )
    throw new Error("Invalid webhook claims");
  if (!equal(await sha256(raw), payload.request_body_sha256))
    throw new Error("Webhook hash mismatch");
  return revisionOf(token);
}
