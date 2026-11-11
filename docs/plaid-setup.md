# Independent Plaid setup and feasibility spike

This requires the account owner's interactive consent. Never paste credentials,
public tokens, Access cookies, account exports or real receipts into GitHub.

1. Create or use an independent Plaid developer application. Check current plan
   eligibility, costs, Schwab support, Investments access and Transactions access
   in the Plaid dashboard. Do not assume Trial entitlement or free production use.
2. In private infra, create the D1 container and Access application. Restrict the
   custom domain to both approved individual identities; designate the owner as
   onboarding administrator. Disable Worker alternative ingress and previews.
3. Apply `migrations/0001_ledger.sql` through the private D1 binding. Supply the
   settings below through the private adapter/Worker secrets, never source files.
4. Configure the exact Plaid redirect URI in its application dashboard if its
   institution OAuth flow requires one. The redirect should return to this app
   behind Access. The browser stores only the short-lived Link token in session
   storage and resumes the same Link session with the received OAuth redirect URI.
   An expired/missing session requires restarting authorization from Data health.
5. Sign in as administrator, open **Data health → Connect selected accounts**,
   and complete the new Link consent. Select exactly the joint checking and joint
   brokerage configured privately by mask. A mismatch rejects onboarding and
   attempts to remove the newly created Item. No unselected account is persisted.
6. Request a sync. Checking begins from an empty cursor; investments query a
   rolling 90-day overlap. Inspect each product's success/error/coverage separately.
7. Privately reconcile a posted external checking receipt, a one-sided
   checking↔brokerage transfer, overdraft funding and its checking-funded card
   payment. Confirm the transfer is excluded and the payment counted once.
8. Locate **one genuine external share receipt** in the independently connected
   investment feed. Verify transaction ID, arrival date, direction, external
   origin, stable security ID, quantity, subtype and any cancellation/correction.
   Positive quantity or a holdings increase is insufficient. If no such event is
   available, retain incomplete coverage and use a reviewed manual receipt.
9. Obtain a historical, unadjusted USD closing price for arrival or the last prior
   trading session from an entitled source. Check its entitlement/rate limits.
   Enter source/date evidence in the review dialog and compare the event valuation
   with independent decimal arithmetic. Preserve that valuation through a later
   sale and an internal cash transfer; neither creates more income.
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
| `ADMIN_EMAILS`                    | Comma-separated onboarding administrator subset                       |
| `CHECKING_ACCOUNT_MASK`           | Last four of the selected checking, set privately                     |
| `BROKERAGE_ACCOUNT_MASK`          | Last four of the selected brokerage, set privately                    |
| `PLAID_ENV`                       | `sandbox` for testing; `production` only after entitlement/consent    |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | Independent application's Worker secrets                              |
| `TOKEN_ENCRYPTION_KEY`            | Base64 encoding of 32 random bytes, Worker secret outside D1          |
| `PLAID_WEBHOOK_URL`               | Exact public HTTPS callback ending `/webhooks/plaid`                  |
| `PLAID_REDIRECT_URI`              | Exact registered institution OAuth redirect, if applicable            |

Create secrets using the private operator's secret-management workflow. The Link
public token is exchanged server-side; Item tokens are AES-256-GCM encrypted in
D1 with Item-bound associated data. Keep the encryption key with the separate
secret backup; restoring D1 alone cannot recover tokens.

Only the **exact callback path** may bypass Cloudflare Access. Its application
handler verifies the Plaid signature, approved algorithm/key, five-minute age,
body hash and replay receipt. All other paths, static assets and APIs require
Access. Install periodic scheduled reconciliation as fallback.

The local `LOCAL_DEMO` mode is loopback-only and refuses real provider credentials.
Do not set it on a deployed environment. Real-data integration occurs on a private,
Access-protected deployment, never the illustrative browser session.

## Provider documentation

- [Transactions Sync](https://plaid.com/docs/transactions/sync-migration/)
- [Investments API](https://plaid.com/docs/api/products/investments/)
- [Product initialization](https://plaid.com/docs/link/initializing-products/)
- [Webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers Static Assets Access caveat](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
