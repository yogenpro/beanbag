# Beanbag next steps

Resumed on November 11, 2026 Pacific. The first implementation milestone and
initial Sandbox integration are committed to the public
[beanbag repository](https://github.com/yogenpro/beanbag). A separate private local
integration CLI is now implemented for the live-data feasibility spike. Cloudflare
deployment belongs to the separate private `infra` repository.

## Previously published baseline

The implementation baseline is [7494ac1](https://github.com/yogenpro/beanbag/commit/7494ac158d73ab88d38e6796643a5ffbb1f9ff2a),
with [passing GitHub CI](https://github.com/yogenpro/beanbag/actions/runs/43150876251).
At closeout, all implementation changes were on `main`; there were no open PRs
or additional remote branches awaiting merge.

- React dashboard with period controls, every-total drilldowns, a review queue,
  decision previews/history, manual stock receipts and separate data health.
- Pure TypeScript boundary accounting with exact cents, historical share
  valuations, pending exclusions and durable review conflicts after corrections.
- D1 migrations/repository, atomic checking cursor publication, investment
  reconciliation, encrypted Item tokens, verified webhook handler and scheduled
  reconciliation entry point.
- Access JWT verification, an identity allowlist, administrator onboarding,
  same-origin mutation checks and rate limits.
- 93 credential-free tests; four desktop/mobile browser tests; production build,
  Worker dry run, local D1 migration and public-source scanning.
- Four additional integration tests passed against Plaid's actual Sandbox API.
  They cover selected-account ingestion, exact cash totals, repeated syncs,
  preserved reviews, a reviewed fractional-share valuation and login failure
  without cursor advance. Temporary Sandbox Items were removed.

The Sandbox suite now defines an explicit `user_custom` household with checking,
unselected savings and brokerage. The default `user_good` sample returned
retirement investment accounts without the expected brokerage account. Keep the
explicit fixture rather than assuming a default account mix.

## Local integration follow-up

The working tree now includes `npm run local -- …`: configuration checking,
Hosted Link consent and retrieval, persistent SQLite ingestion, product health,
and a private evidence report. It reuses the accounting and sync modules without
changing the production Worker or illustrative UI. See
[local integration](local-integration.md) for the operator workflow.

Credentials, ledger files and encryption keys stay outside Git. Item tokens and
pending consent are encrypted; the key stays outside the ledger directory.
The tool validates exactly the selected checking/brokerage pair and retains
encrypted state for exchange retries or failed Item cleanup. There is no local
listener, scheduled polling, local review UI or update-mode repair in this spike.

The credential-free suite now has 107 passing tests, including persistent
restart/review checks, credential isolation, key recovery refusal, consent retry
and cleanup cases. Build, privacy scan and Worker dry run pass. The new Hosted
Link creation/retrieval check also passed against Sandbox; it revealed that an
unopened session can omit `link_sessions`, which is now treated as pending.

All five Sandbox integration tests pass. The checking fixture now waits for
`HISTORICAL_UPDATE_COMPLETE` before adding transactions; earlier runs injected
them during initialization and received empty selected and unfiltered streams.
This changes test setup ordering, not application coverage claims. Temporary
Sandbox Items and local test state were removed.

## Production local connection — November 12, 2026

The owner completed independent Production Hosted Link consent. The local tool
exchanged the token and verified exactly the privately configured checking and
brokerage pair. Both product syncs succeeded, and both checking and investment
source records are present in the private ledger. Pending Link state was cleared.

The private evidence report passed structural checks for account isolation,
source/event correspondence, integer cents, pending exclusion and recomputed
period totals. The owner has now attested that the private share-transfer
candidates are incoming from outside the pair and that dates and quantities
match brokerage activity. The attestation is saved privately; historical closing
price provenance still needs verification before the receipts enter totals.
These checks do not independently reconcile the financial records or establish
complete-through coverage. No production deployment is established.

Preserve the existing local ledger and its separate encryption key. Start with
`npm run local -- status` when resuming; do not create a duplicate Link Item or
replace the private account configuration. No unattended sync is enabled.

## Resume locally

The owner subsequently requested a **strictly read-only dashboard** for simplicity.
This supersedes the browser review/edit workflow described in the older milestones.
The current UI has Overview, Activity and Data health; unclassified entries are
informational exclusions with read-only detail/source/history views. No review
queue, receipt entry, connection management or manual sync control remains.
All dashboard API mutations are rejected for every identity (including admins).
“Refresh view” performs a GET of saved data. Ingestion and financial maintenance
belong to private operator tooling or separately authenticated provider ingestion.
Hosted consent/repair provisioning needs a private operator path before deployment;
do not restore browser write routes to complete it. The current automated suite
has 141 passing tests, including rejection of writes without database/provider
effects. Four desktop/mobile checks cover read-only browsing and no write requests.

The owner also requested current tracked-account value/net worth and a history
chart. The working tree now includes immutable balance observations, exact-cent
aggregation, brokerage borrowing handling, independent balance health and an
interactive Overview chart. Latest value is independent of the reporting period;
history shows only saved Pacific-day observations. No past balance is inferred
from transactions. The first private snapshot is saved; reconciliation notes and
any provider/owner discrepancy remain in private evidence, not public fixtures.

The private CLI `report` also writes `account-values.html` outside Git, reusing
the dashboard component as a read-only offline view with embedded fonts and no
scripts/network access. Open it locally to inspect the actual saved balances.
It is separate from the illustrative browser and updates only when regenerated.
Balance collection uses `npm run local -- balances` or an explicit `sync`.
There is no new background job. `0002_balances.sql` must be applied by private
infra before the new Worker is deployed; the local CLI migrates its own ledger.

The updated backend suite has 127 passing tests. The balance-view browser checks
cover keyboard snapshot selection, the daily table, period changes that preserve
the latest value, and the existing review flows. Visual inspection includes
single-snapshot, empty, missing-balance, borrowing-conflict and failed-refresh
states with invented data only.
The finish review requested a clearer isolated snapshot marker; a fixed-size
circular marker now remains visible on desktop/mobile. The reviewer scored that
fix resolved and returned `ship`. The offline export also passed a zero-network,
no-script browser check. The accepted design system files remain unchanged.

The dashboard was redesigned with Impeccable on November 12 using the owner's
selected “crisp and understated — white, ink, restrained blue” direction.
`PRODUCT.md` records its product constraints; `DESIGN.md` and
`.impeccable/design.json` record the implemented visual system. The local Impeccable
skill is installed separately from application dependencies. Runtime screenshots
stay ignored; shared design context is safe to keep with source.

The UI build and all four desktop/mobile browser tests pass. Additional visual
checks cover 320, 390, 820, 1100 and 1440px widths, yearly reports, filtered
drilldowns, review and receipt dialogs, data health, and empty states. The initial
redesign's source detector reported no findings. The later balance extension
also surfaced advisories about pre-existing CSS values missing from the generated
design documentation; the accepted system was preserved, with no documentation
repair or visual redesign. This redesign does not connect the browser
to the private production ledger; share-transfer evidence verification remains
the next integration gate below.

Use Node 24 and the committed npm lockfile:

```sh
npm ci
npm run check
npm run dev
```

The UI at `http://127.0.0.1:8787` is **Illustrative**. Its read-only repository is
in memory; a Worker restart resets the invented observations. Applying local
D1 migrations does not make the demo read that database.

For provider verification, run the separate suite:

```sh
npm run test:sandbox -- --check-config
npm run test:sandbox
```

The validated Sandbox credentials are in the owner-only local file
`~/.config/beanbag/plaid-sandbox.env`, outside Git. The separate
`~/.config/beanbag/plaid.env` is the validated live-connection configuration path;
its selected connection has returned both checking and investment data. Do not
print either file.
The public repository contains neither key values nor returned provider IDs.

The live connection is already established. Resume with status and the private
report. A further bounded sync can be requested when refreshing the evidence:

```sh
npm run local -- check-config
npm run local -- status
npm run local -- report
```

Use `npm run local -- sync` for a bounded refresh when needed. The first-time
consent flow is documented in [local integration](local-integration.md); do not
repeat it for the already connected ledger.

The private report is `evidence.json` in the local data directory. The demo UI
does not read this ledger. No real financial data should appear in test artifacts.

The optional **Plaid Sandbox** workflow is manual and uses repository secrets
`PLAID_SANDBOX_CLIENT_ID` and `PLAID_SANDBOX_SECRET`. Those CI secrets were not
provisioned in this session; the successful API run was local. Ordinary CI stays
credential-free. See [Sandbox testing](sandbox-testing.md).

## Next work in order

1. **Reconcile real checking and securities evidence privately.** Verify external
   deposits, card payments, one-sided internal transfers and overdraft funding.
   Inspect at least one genuine incoming share transfer: arrival date, quantity,
   stable security identity, incoming direction and external origin. Keep
   ambiguous entries in review. Turn verified provider shapes into invented
   regression fixtures rather than committing exports or actual records.
2. **Select historical pricing.** Verify entitlement and obtain the unadjusted
   USD close on arrival, or the last prior trading session. Preserve price/date/
   source provenance and the original event value. The current adapter accepts
   reviewed evidence; an automatic historical price service is not selected.
   Verify that a subsequent sale and internal cash transfer create no second
   income event. Keep the manual receipt fallback if feed coverage is incomplete.
3. **Maintain deployment in private infra.** The owner requested deployment and
   automatic application updates from main. Public checks now request a fixed-main
   Cloudflare build; infra owns the adapter, gated ingress, build hook, deployment
   credential and private D1. Keep current rollout evidence in its private runbook.
   Infra owns domains,
   Access identities/policies, D1 identity, cron and build orchestration. The app
   owns portable code, migrations/assets and binding contracts. Preserve
   `assets.run_worker_first`, disabled workers.dev/previews, and protection for
   pages and APIs. Only the exact Plaid callback gets its separate signature
   verification path. Establish the gate before publishing the hostname.
4. **Verify operation before enabling unattended use.** Test both approved
   identities, denial of logged-out/third-party users, real Link/update mode,
   signed webhook delivery, scheduled fallback sync, independent product health,
   and an isolated encrypted backup/restore. Configure the private settings and
   encryption-key backup using [operations](operations.md).

## Limits to preserve

Sandbox success establishes the API integration with simulated data. Share-price
provenance, interactive household sign-in, webhook delivery, bank polling and
backup recovery remain separate acceptance work. Bank polling remains off for
the initial saved-data deployment. The private infra runbook records live
deployment, Access and D1 checks without publishing infrastructure identities.

The accounting boundary stays fixed: external checking receipts plus verified
incoming shares are income; checking payments outside the pair are spending;
internal cash transfers, trades, brokerage dividends and appreciation are
excluded. Stock income is in-kind reporting, not cash or taxable wages.

Before larger backfills, review the current 5,000-change/100-page staging cap,
90-day investment overlap, in-memory report/reclassification work and provider
request timeouts. Coverage through a particular date remains unknown unless
established independently. See [architecture](architecture.md) for details.

All future public commits must keep credentials, household identities, deployment
IDs, actual account masks and financial records outside the source tree. The
original owner-supplied design handoff remains private. The next steps above are
pending work, not scheduled jobs or completed setup.
