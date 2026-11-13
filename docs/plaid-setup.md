# Independent Plaid setup and feasibility spike

This requires the account owner's interactive consent. Never paste credentials,
public tokens, Access cookies, account exports or real receipts into GitHub.

The [private local CLI](local-integration.md) now supports the initial feasibility
spike before deployment. It uses Hosted Link and retrieves consent through the
API, so it needs no public callback or local server. The instructions below are
the private operator and Access-protected hosting responsibilities. The dashboard
is read-only and has no consent, repair, review or sync controls.

1. Create or use an independent Plaid developer application. Check current plan
   eligibility, costs, Schwab support, Investments access and Transactions access
   in the Plaid dashboard. Do not assume Trial entitlement or free production use.
2. In private infra, create the D1 container and Access application. Restrict the
   custom domain to both approved individual identities, with read-only access.
   Disable Worker alternative ingress and previews.
3. Apply all SQL files in `migrations/` in order through the private D1 binding. Supply the
   settings below through the private adapter/Worker secrets, never source files.
4. For first-time local consent, follow the private CLI's Hosted Link workflow.
   Preserve an existing authorized Item and selected pair; do not reconnect just
   to view the dashboard. Provider redirects/consent stay outside this UI.
5. The private CLI owns its local SQLite ledger. A hosted D1 deployment needs a
   separate private provisioning/repair adapter for its accounts and encrypted
   Item token before ingestion is enabled. That adapter is not implemented here;
   browser mutation endpoints must not be reintroduced as a shortcut.
6. Run an explicit local `sync` or the hosted ingestion entry point through
   authorized operator tooling. Checking uses its saved cursor; investments query
   a rolling 90-day overlap. Inspect each product's status/coverage separately.
7. Privately reconcile a posted external checking receipt, a one-sided
   checking↔brokerage transfer, overdraft funding and its checking-funded card
   payment. Confirm the transfer is excluded and the payment counted once.
8. Locate **one genuine external share receipt** in the independently connected
   investment feed. Verify transaction ID, arrival date, direction, external
   origin, stable security ID, quantity, subtype and any cancellation/correction.
   The current convention classifies incoming/outgoing transfers automatically;
   this independent evidence check concerns provider fidelity and complete feed
   coverage. A holdings increase alone still cannot create a transfer event.
9. Use the recorded transfer unit price with exact quantity, as selected by the
   owner. Preserve its provider/date evidence and compare with independent decimal
   arithmetic. Saved, reviewed historical closes remain a fallback when the
   transfer price is absent; current holdings prices never fill that gap.
   Preserve the valuation through a later sale and an internal cash transfer;
   neither creates more income.
10. Record the outcome only in private operations notes. A future automatic
    adapter must be backed by a real redacted event and synthetic regression cases.
    Do not copy private data or the original design handoff into this public repo.

## Private settings

| Setting                           | Meaning                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| `APP_ORIGIN`                      | Exact HTTPS origin of the private application                         |
| `ACCESS_ISSUER`                   | Exact `https://<team>.cloudflareaccess.com` issuer, no trailing slash |
| `ACCESS_AUD`                      | Access application audience                                           |
| `ALLOWED_EMAILS`                  | Comma-separated approved individual identities                        |
| `CHECKING_ACCOUNT_MASK`           | Local operator selection: last four of checking                       |
| `BROKERAGE_ACCOUNT_MASK`          | Local operator selection: last four of brokerage                      |
| `PLAID_ENV`                       | `sandbox` for testing; `production` only after entitlement/consent    |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | Independent application's Worker secrets                              |
| `TOKEN_ENCRYPTION_KEY`            | Base64 encoding of 32 random bytes, Worker secret outside D1          |
| `PLAID_WEBHOOK_URL`               | Exact public HTTPS callback ending `/webhooks/plaid`                  |

Create secrets using the private operator's secret-management workflow. The Link
public token is exchanged server-side; Item tokens are AES-256-GCM encrypted in
D1 with Item-bound associated data. Keep the encryption key with the separate
secret backup; restoring D1 alone cannot recover tokens.

Only the **exact callback path** may bypass Cloudflare Access. Its application
handler verifies the Plaid signature, approved algorithm/key, five-minute age,
body hash and replay receipt. All other paths, static assets and APIs require
Access. Install periodic scheduled reconciliation as fallback.

The local `LOCAL_DEMO` mode is loopback-only and refuses real provider credentials.
Do not set it on a deployed environment. Real-data integration uses either the
separate private local CLI or an Access-protected deployment. The illustrative
browser session never reads the local integration ledger.

## Provider documentation

- [Transactions Sync](https://plaid.com/docs/transactions/sync-migration/)
- [Investments API](https://plaid.com/docs/api/products/investments/)
- [Product initialization](https://plaid.com/docs/link/initializing-products/)
- [Webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers Static Assets Access caveat](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
