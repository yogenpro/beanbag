# Beanbag

A private, standalone household ledger for **two selected accounts**: joint
checking and joint brokerage. React + TypeScript, a Hono Cloudflare Worker,
D1/SQLite, independent Plaid authorization, and Cloudflare Access.

The public repository contains portable code and invented test/demo records.
Deployment identities, household account selection, credentials, financial data,
and infrastructure policies stay private. There is no ChatGPT runtime dependency.

## Run the illustrative preview

Requires Node 24+ and npm.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8787`. All figures are explicitly **Illustrative**.
The local demo uses an in-memory repository; changes survive page reloads but
reset when the Worker restarts. `npm run dev:ui` gives Vite hot reload while
the Worker is running. `npm run db:local` applies the migration to a separate
local D1 database; demo mode deliberately does not read it.

```sh
npm run check          # accounting, sync, SQL persistence, security, type/build, privacy, Worker dry run
npx playwright install chromium
npm run test:browser   # desktop/mobile interactions against the local Worker
```

For an existing browser installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to its executable. No test needs bank credentials or actual financial records.

## Reporting convention

| Movement                                                                      | Treatment                                       |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| External cash received in selected checking                                   | Checking income                                 |
| External securities received in selected brokerage                            | In-kind income at historical arrival-date close |
| Checking payment outside this pair, including card payments                   | Checking spending                               |
| Checking ↔ selected brokerage cash transfer, including overdraft funding      | Excluded internal transfer                      |
| Brokerage trades, dividends, interest, corporate actions, appreciation        | Excluded investment activity                    |
| Pending, unverified receipt, ambiguous transfer, missing historical valuation | Outside confirmed totals; separately visible    |

`Net cash flow = checking income − checking spending`.
`Net recorded inflow = checking income + stock income − checking spending`.
Stock income is not cash or a measure of taxable wages. Card purchase feeds are
not imported. Transfers to other personal accounts are outside this boundary.

Money uses integer cents. Exact decimal quantities and prices use BigInt-backed
arithmetic, rounding half away from zero once per event. Institution date-only
posting dates remain unchanged; date presets use America/Los_Angeles.

Every total has a source drilldown. Review decisions include rationale, reviewer,
timestamp and source revision. A provider correction preserves the decision and
raises a review conflict. Sources and classification remain separate.

## Status and the real-data feasibility gate

The first implementation milestone provides the accounting backend, synthetic
feasibility spike and an interactive dashboard. See [implementation](docs/implementation.md),
[architecture](docs/architecture.md), and [operations](docs/operations.md).

**Live Schwab/Plaid feasibility is unverified.** The app needs its own Plaid
developer application, product access and new user consent. An existing
connection in another application supplies no credentials or reusable consent.
Incoming investment transfers remain review candidates: provider type, positive
quantity, or holdings increases alone never prove external origin. The stock
path currently uses reviewed historical quotes/manual receipts; a paid or
licensed automatic price provider is not selected or enabled.

To complete that external gate, follow [Plaid setup and spike](docs/plaid-setup.md).
Do not claim fully automated share income until a genuine incoming transfer has
been reconciled to institution evidence. Last successful sync is never presented
as proof of complete coverage.

## Deployment contract

The existing private `infra` repository owns deployment. This project does not
deploy from GitHub CI. The portable `wrangler.jsonc` has no production account ID,
domain, database ID, Access audience, household identity or account mask.

`infra` should supply a disposable private Wrangler configuration with:

- Worker name, `DB` D1 binding, `ASSETS`, and the checked-in migration directory.
- `assets.run_worker_first: true`, disabled `workers_dev` and `preview_urls`.
- Custom domain behind an Access gate, covering pages and API routes.
- Two approved individual identities and an administrator subset.
- A periodic `scheduled` trigger, plus an exact, separately secured webhook URL.
- The private settings and Worker secrets described in the setup guide.

The application verifies signed Access JWTs independently, including issuer,
audience, algorithm, expiry and the configured identity allowlist. It does not
trust an email header or `ctx.access`; Static Assets routing can omit the latter.
The only unauthenticated application route is `POST /webhooks/plaid`, which
requires Plaid's ES256 signature, age check, exact-body SHA-256 and replay receipt.

Keep domains and Access policies in Terraform, and code/assets/bindings in the
app build adapter. Bootstrap with closed ingress, establish the gate, then attach
the domain. No production infrastructure is created by this repository.
