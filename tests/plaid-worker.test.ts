import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { describe, expect, it } from "vitest";

// Native workerd fetch checks its receiver. Node fetch and ordinary mocks do not.
// All outbound traffic is intercepted; no credentials or provider network is used.
describe("Plaid transport in the Worker runtime", () => {
  it("calls native fetch with its global receiver", async () => {
    const bundled = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "ts",
        contents: `
          import { PlaidClient } from './src/providers/plaid/client';
          export default { async fetch() {
            const client = new PlaidClient('synthetic-client', 'synthetic-secret', 'sandbox');
            const response = await client.post('/accounts/get', { access_token: 'synthetic-token' });
            return Response.json({ ok: response.accounts.length === 0 });
          }};
        `,
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      target: "es2022",
      logLevel: "silent",
    });
    let providerCalls = 0;
    const worker = new Miniflare(
      convertV4MiniflareOptions({
        host: "127.0.0.1",
        name: "plaid-client-test",
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: "2026-11-01",
        outboundService: (request) => {
          providerCalls++;
          expect(new URL(request.url).pathname).toBe("/accounts/get");
          return Response.json({ accounts: [] });
        },
      }),
    );
    try {
      const response = await worker.dispatchFetch("http://127.0.0.1/");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(providerCalls).toBe(1);
    } finally {
      await worker.dispose();
    }
  }, 15000);
});
