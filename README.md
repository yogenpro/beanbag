# Beanbag

A private, standalone household ledger for **two selected accounts**: joint
checking and joint brokerage. React + TypeScript, a Hono Cloudflare Worker,
D1/SQLite, independent Plaid authorization, and Cloudflare Access.

The public repository contains portable code and invented test/demo records.
Deployment identities, household account selection, credentials, financial data,
and infrastructure policies stay private. There is no ChatGPT runtime dependency.

The dashboard is **strictly read-only**: Overview, Activity, and Data health.
Charts, filters and record details let you inspect saved information. Unclassified
entries remain excluded from income/spending with an explanatory note; there is
no review queue, editing form, receipt entry, connection control or sync action.
Dashboard APIs accept only GET/HEAD. “Refresh view” reloads saved data; provider
ingestion runs separately through operator tooling or the authenticated worker.

Resume implementation from [next steps](docs/next-steps.md), which records the
verified baseline and the remaining live-data and deployment work.

## Run the illustrative preview

Requires Node 24+ and npm.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8787`. All figures are explicitly **Illustrative**.
The local demo uses an in-memory repository that resets when the Worker restarts.
Viewing and filtering never change its records. `npm run dev:ui` gives Vite hot reload while
the Worker is running. `npm run db:local` applies the migration to a separate
local D1 database; demo mode deliberately does not read it.

```sh
npm run check          # accounting, sync, SQL persistence, security, type/build, privacy, Worker dry run
npx playwright install chromium
npm run test:browser   # desktop/mobile interactions against the local Worker
```

For an existing browser installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to its executable. No test needs bank credentials or actual financial records.

An optional [Plaid Sandbox integration suite](docs/sandbox-testing.md) exercises
the real Sandbox API, provider-created transactions and SQLite persistence.
Run `npm run test:sandbox` after saving separate private Sandbox credentials.
The normal checks remain credential-free; test code and synthetic scenarios can
be published without publishing any API secret.

For the real-data feasibility spike, use the separate [private local integration
tool](docs/local-integration.md): `npm run local -- check-config`, then `connect`,
`complete-link`, `sync` and `report`. It uses owner-operated Hosted Link consent,
private SQLite storage outside Git and a separately stored encryption key.
It does not connect the illustrative dashboard or change production Access policy.

## Reporting convention

| Movement                                                                     | Treatment                                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| External cash received in either selected account                            | Cash income                                     |
| External securities received in either selected account                      | In-kind income at the recorded transfer price   |
| External cash payments from either account, including card payments          | Cash expenses                                   |
| External share transfers out of either account                               | In-kind expenses at the recorded transfer price |
| Checking ↔ selected brokerage transfer, including overdraft funding          | Excluded internal transfer, counted once        |
| Brokerage trades, dividends, interest, fees, corporate actions, appreciation | Excluded investment activity                    |
| Pending, removed, missing direction/identity/quantity or transfer price      | Outside confirmed totals; separately visible    |

`Net cash flow = cash income − cash expenses`.
`Net recorded inflow = cash income + stock income − cash expenses − stock expenses`.
Stock income is not cash or a measure of taxable wages. Card purchase feeds are
not imported. Transfers to other personal accounts are outside this boundary.

Money uses integer cents. Exact decimal quantities and prices use BigInt-backed
arithmetic, rounding half away from zero once per event. Institution date-only
posting dates remain unchanged; date presets use America/Los_Angeles.

The range tabs are Last 1 month (default), Last 3 months, Last 6 months, Year to
date, Last year and Max. The first three default to inclusive rolling calendar
months ending today; their dropdowns also offer calendar months, quarters and
half-years. Current calendar periods end today. Year to date offers years through
the same calendar day (clamping leap days); Last year defaults to the previous
complete calendar year. Max covers all saved dates, including imported history.
All charts and totals follow the selected period; the latest account value stays
independent of it.

Balance history and transaction history have separate coverage. Historical daily
account values do not create income or expense records. A private operator can
backfill missing provider-ID transactions using an authorized Assets report for
checking and investment transaction history for brokerage. Existing IDs, source
records, receipt valuations and cursors stay intact. The UI shows loaded
transaction dates, flags partial periods and withholds empty totals outside known
history. Loaded provider windows do not establish independently complete records.

Every total has a source drilldown. Review decisions include rationale, reviewer,
timestamp and source revision. A provider correction preserves the decision and
raises a review conflict. Sources and classification remain separate. Normal
incoming transfers require no per-receipt origin approval: unmatched transfers
are external by convention. Explicit counterpart/mask evidence excludes a
one-sided internal transfer; unique reciprocal transfer legs with matching
currency/value and dates within three days are paired automatically. Ordinary
same-amount payments are not paired as transfers. Ambiguous matches are not
arbitrarily paired. Original provider records remain available for inspection.

## Tracked account value

Overview also shows the latest reported checking and brokerage balances and a
chart of saved daily observations. Tracked net worth is their combined current
value less brokerage borrowing; it covers only these two accounts.
Brokerage cash is already included in its account value. Holdings and stock
receipt income are never added on top of the balance.

Borrowing is a normal liability: each snapshot automatically subtracts its
reported margin loan, including zero borrowing, later borrowing and repayment.
No owner confirmation is needed. Missing USD balances or borrowing remain unknown;
the dashboard shows account value before borrowing when a net total is unavailable.
Collection time and institution update time are distinct. Balance data comes
from existing Plaid products and can be cached; no real-time quote is promised.
History combines saved observations with private daily account-value exports and
Plaid Assets checking history. Export dates are preserved as supplied; collection
time stays separate. Already-net brokerage values are used directly, so borrowing
is not deducted twice. Institution exports take precedence over calculated Assets
history for the same account/date. A total requires both selected accounts on the
same date; missing values are not filled with zero. Past holdings/quotes are not
reconstructed. Changes
include market moves and external flows, not just investment returns. Stock
receipt income remains fixed at its reviewed historical value.

Imported history lives in `account_value_history` (migration
`0003_account_history.sql`), separate from immutable balance observations and
financial events. The latest value remains independent of the reporting period.

## Status and the real-data feasibility gate

The first implementation milestone provides the accounting backend, synthetic
feasibility spike and an interactive dashboard. See [implementation](docs/implementation.md),
[architecture](docs/architecture.md), and [operations](docs/operations.md).

**Live Schwab/Plaid feasibility is unverified.** The app needs its own Plaid
developer application, product access and new user consent. An existing
connection in another application supplies no credentials or reusable consent.
The owner's revised flow convention counts unmatched incoming/outgoing transfer
records automatically, using their exact quantity and recorded unit price. This
is a reporting convention, not independent proof of every transfer's origin or
complete feed coverage. Trades/dividends/interest/fees stay excluded. Saved
historical-close evidence remains supported when a recorded transfer price is
missing; current holdings prices never substitute for a missing transfer value.

To complete that external gate, follow [Plaid setup and spike](docs/plaid-setup.md).
The provider's recorded transfer price is not a tax-income determination or a
promise of the market closing price. Last successful sync is never presented as
proof of complete coverage.

## Deployment contract

The existing private `infra` repository owns deployment. Successful checks for a
trusted `main` push request a fixed-main Cloudflare build using an encrypted
deploy-hook capability. Cloudflare runs the checked build with the private
adapter and deployment credential; no Cloudflare API token enters public CI.
The portable `wrangler.jsonc` has no production account ID, domain, database ID,
Access audience, household identity or account mask.

`infra` should supply a disposable private Wrangler configuration with:

- Worker name, `DB` D1 binding, `ASSETS`, and the checked-in migration directory.
- `assets.run_worker_first: true`, disabled `workers_dev` and `preview_urls`.
- Custom domain behind an Access gate, covering pages and API routes.
- Explicitly approved individual identities with read-only dashboard access.
- A periodic `scheduled` trigger and separately secured webhook only when enabled.
- The private settings and Worker secrets described in the setup guide.

The application verifies signed Access JWTs independently, including issuer,
audience, algorithm, expiry and the configured identity allowlist. It does not
trust an email header or `ctx.access`; Static Assets routing can omit the latter.
The only unauthenticated application route is `POST /webhooks/plaid`, which
requires Plaid's ES256 signature, age check, exact-body SHA-256 and replay receipt.

Keep domains and Access policies in Terraform, and code/assets/bindings in the
app build adapter. Bootstrap with closed ingress, establish the gate, then attach
the domain. No production infrastructure is created by this repository.

Ordinary `main` code changes deploy automatically after checks pass. Schema
changes require private migration/backup review before the adapter accepts them.
Automatic code deployment is separate from bank-data polling, which remains off
for the initial saved-data rollout.
