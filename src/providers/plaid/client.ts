import { isLosslessNumber, parse, stringify } from "lossless-json";

export type JsonRecord = Record<string, any>;
export interface PlaidApi {
  post<T extends JsonRecord = JsonRecord>(
    path: string,
    body: JsonRecord,
  ): Promise<T>;
}
export class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function decimalText(value: unknown): string {
  if (isLosslessNumber(value)) return value.value;
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  throw new Error("Missing decimal");
}
export const rawJson = (value: unknown): string => stringify(value) ?? "{}";
export class PlaidClient implements PlaidApi {
  private readonly base: string;
  constructor(
    private readonly clientId: string,
    private readonly secret: string,
    environment: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!["sandbox", "production"].includes(environment))
      throw new Error("Unsupported Plaid environment");
    this.base =
      environment === "production"
        ? "https://production.plaid.com"
        : "https://sandbox.plaid.com";
  }
  async post<T extends JsonRecord = JsonRecord>(
    path: string,
    body: JsonRecord,
  ): Promise<T> {
    if (!/^\/[a-z_]+(?:\/[a-z_]+)+$/.test(path))
      throw new Error("Invalid provider path");
    const response = await this.fetcher(this.base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Plaid-Version": "2020-09-14",
      },
      body: JSON.stringify({
        ...body,
        client_id: this.clientId,
        secret: this.secret,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = parse(await response.text()) as T;
    if (!response.ok)
      throw new ProviderError(
        typeof payload.error_code === "string" &&
          /^[A-Z_]+$/.test(payload.error_code)
          ? payload.error_code
          : "PROVIDER_FAILURE",
      );
    return payload;
  }
}
