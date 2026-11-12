# Beanbag next steps

Session closed at the owner's request on November 11, 2026 Pacific. The first
implementation milestone and Sandbox integration are committed to the public
[beanbag repository](https://github.com/yogenpro/beanbag). Resume with the live-data
feasibility spike below. Cloudflare deployment belongs to the separate private
`infra` repository.

## Completed and verified

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

## Resume locally

Use Node 24 and the committed npm lockfile:

```sh
npm ci
npm run check
npm run dev
```

The UI at `http://127.0.0.1:8787` is **Illustrative**. Its repository is in memory;
page reloads preserve edits while a Worker restart resets them. Applying local
D1 migrations does not make the demo read that database.

For provider verification, run the separate suite:

```sh
npm run test:sandbox -- --check-config
npm run test:sandbox
```

The validated Sandbox credentials are in the owner-only local file
`~/.config/beanbag/plaid-sandbox.env`, outside Git. The separate
`~/.config/beanbag/plaid.env` is the live-connection configuration path; its
credentials and entitlement have not been validated. Do not print either file.
The public repository contains neither key values nor returned provider IDs.

The optional **Plaid Sandbox** workflow is manual and uses repository secrets
`PLAID_SANDBOX_CLIENT_ID` and `PLAID_SANDBOX_SECRET`. Those CI secrets were not
provisioned in this session; the successful API run was local. Ordinary CI stays
credential-free. See [Sandbox testing](sandbox-testing.md).

## Next work in order

1. **Prepare a separate local integration path for real data.** The existing
   `LOCAL_DEMO` profile deliberately refuses provider credentials. Implement a
   protected local profile or a bounded CLI spike with separate persistent
   storage and private settings. Preserve production Access verification and
   keep demo records separate. Supplying keys alone does not connect the UI.
2. **Complete independent Plaid authorization.** Confirm the owner's current
   Trial/Production eligibility, Transactions and Investments access, and Schwab
   availability. Have the owner complete a new Link consent for exactly the
   selected checking/brokerage pair. Discover fresh provider IDs and resolve the
   boundary from private configuration. An existing connection in another
   application provides no reusable token or consent. Follow
   [Plaid setup](plaid-setup.md); its hosted path can follow the local spike.
3. **Reconcile real checking and securities evidence privately.** Verify external
   deposits, card payments, one-sided internal transfers and overdraft funding.
   Inspect at least one genuine incoming share transfer: arrival date, quantity,
   stable security identity, incoming direction and external origin. Keep
   ambiguous entries in review. Turn verified provider shapes into invented
   regression fixtures rather than committing exports or actual records.
4. **Select historical pricing.** Verify entitlement and obtain the unadjusted
   USD close on arrival, or the last prior trading session. Preserve price/date/
   source provenance and the original event value. The current adapter accepts
   reviewed evidence; an automatic historical price service is not selected.
   Verify that a subsequent sale and internal cash transfer create no second
   income event. Keep the manual receipt fallback if feed coverage is incomplete.
5. **Prepare deployment in private infra.** Read that repository's instructions
   and existing build-adapter pattern before editing it. Infra owns domains,
   Access identities/policies, D1 identity, cron and build orchestration. The app
   owns portable code, migrations/assets and binding contracts. Preserve
   `assets.run_worker_first`, disabled workers.dev/previews, and protection for
   pages and APIs. Only the exact Plaid callback gets its separate signature
   verification path. Establish the gate before publishing the hostname.
6. **Verify operation before enabling unattended use.** Test both approved
   identities, denial of logged-out/third-party users, real Link/update mode,
   signed webhook delivery, scheduled fallback sync, independent product health,
   and an isolated encrypted backup/restore. Configure the private settings and
   encryption-key backup using [operations](operations.md).

## Limits to preserve

Sandbox success establishes the API integration with simulated data. Real Schwab
share-transfer representation, live Access policy, webhook delivery, cron and
backup recovery remain unverified. No application was deployed to Cloudflare
and no private `infra` changes were made in this session.

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
original owner-supplied design handoff remains private. This session is finished;
the next steps above are pending work, not scheduled jobs or completed setup.
