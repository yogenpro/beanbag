# Implementation checklist

Beanbag counts movement across a boundary of exactly two explicitly selected
accounts: joint checking and joint brokerage. It is a reporting convention,
not tax income or credit-card purchase accounting. A separate balance view now
tracks the latest value/net worth of that selected pair and saved daily history.

Current policy is boundary-2, selected by the owner after the first deployment:
cash/share transfers in/out of either tracked account are income/expenses;
internal pair transfers, brokerage dividends/interest/fees and trading are
excluded. Normal share transfers use their recorded institution price and need
no per-event origin approval. Current rules apply to saved evidence on read;
original source/cache records are preserved. Net worth automatically subtracts
each snapshot's reported borrowing. No confirmation workflow or owner override
is needed; missing provider borrowing remains unknown.
Older checklist entries below describe the original milestone and its gates.

Daily brokerage reconstruction now provides explicit estimates for historical
gaps under the owner's same-day settlement convention. The exact-decimal replay
uses all account activity and as-traded historical prices, handles share splits,
and fails on missing prices or unsupported short positions. Explicit issuer NAV
evidence supports stable money funds. Derived values use a separate additive
table and preserve reported-value priority, latest balances and receipt income.
The read-only chart labels estimates and explains their settlement assumption.
The suite now passes 204 tests and ten desktop/mobile browser checks, including
derived-history persistence, reported priority, borrowing, fractional quantities,
split handling, prior-close selection and invalid evidence rejection.

Selected-period balance changes now have an aligned breakdown of total change,
income less external expenses, and estimated investment gain/loss. The opening
value uses the day before the period when available; a missing opening or ending
date yields an explicit shorter comparison, never a fabricated balance. The
residual includes dividends, interest, fees and valuation/timing differences.
Unknown transaction windows or unresolved flows withhold the split. Current
reported values, historical balances and receipt valuations are unchanged. The
suite passes 216 checks and twelve desktop/mobile browser checks, including
first-day flows, in-kind outflows, negative equity, borrowing, partial periods,
losses during account growth, missing history, period changes and read-only API
behavior. The local private offline report reuses the same calculation.

- [x] M0: Worker + React + Hono scaffold, D1 migration and synthetic local spike.
- [ ] M0 external: independent Plaid consent, product/plan access and one genuine
      incoming securities transfer verified against institution evidence.
- [x] M1: exact cents, deterministic rules, reviewed historical valuation, durable overrides.
- [x] M1: idempotent checking cursor sync and bounded investment reconciliation.
- [x] M1: period aggregates, audit drilldowns, review queue and coverage status.
- [x] M1: boundary, correction, replay, security and persistence tests.
- [x] Preview: responsive illustrative dashboard using the same accounting engine.
- [x] Publish: public-source privacy check, initialize Git, public GitHub repository.

Public source: [yogenpro/beanbag](https://github.com/yogenpro/beanbag).

Private `infra` owns deployment identity, D1 containers, Access applications,
allowlisted identities, domains and build orchestration. Application source owns
code, assets, migrations and portable binding contracts. No production deployment
or infrastructure mutation is part of this implementation milestone.

The accounting engine and provider interfaces do not depend on Workers. D1 is
the production persistence adapter. A Node SQLite adapter now supports the
[private local CLI spike](local-integration.md); a hosted VPS service is deferred.

## Read-only dashboard — November 12

The owner requested a strictly read-only dashboard after accepting the visual
design. This supersedes the milestone's browser review queue and mutation flows.
Overview, Activity and Data health remain; record details and existing decision
history are viewable. Unclassified entries are explained as exclusions from
income/spending rather than presented as work to perform. Browser receipt entry,
classification edits, Link consent/repair and manual sync controls are removed.
The server rejects non-GET/HEAD dashboard API requests for all identities without
database writes or provider calls. Signed webhooks, scheduled ingestion and the
private operator CLI retain their separate roles. No new unattended job is enabled.

## Verification

The local implementation passes 128 accounting, ingestion, balance history, SQLite persistence,
Access/read-only API/encryption/webhook, credential isolation and publication-guard tests.
Type checking, production UI build, Worker dry run and public-source privacy
scanning pass. The redesigned UI passes four browser tests across desktop/mobile;
the published baseline also passed a real local D1 migration. Browser testing includes
read-only source drilldowns, unchanged totals after browsing, date controls,
pending exclusions, historical valuation, chart selection and data health.
Browser interactions issue no write requests and have no horizontal page overflow.

The November 12 visual update uses the owner's crisp white, ink and restrained
blue direction with Impeccable. It replaces the original card-heavy treatment
with persistent navigation, open financial summaries, distinct cash/in-kind
series and responsive activity rows. Data health remains a dedicated view. The
overview's filtered “View all” action now preserves its selected record filter.
Product context and the built visual system live in `PRODUCT.md`, `DESIGN.md`
and `.impeccable/`; generated review screenshots are ignored and illustrative only.

Independent Production Plaid consent and initial checking/investment sync have
now succeeded through the private local CLI. Both feeds contain source records,
and structural account-isolation and report checks pass. The owner attested to
the incoming candidates' external origin, dates and quantities; historical price
evidence remains pending. See [next steps](next-steps.md) for the private workflow.
Independent receipt valuation, an entitled automatic historical-price feed, private
Access policy provisioning, and live backup/restore remain later work. Reviewed
historical quotes and manual receipts are the implemented fallback; no unattended
financial automation or deployment is claimed.

Tracked-account balance history uses separate observations and never revalues
receipt income. The latest account value, borrowing and net worth have explicit
missing/conflicting states, with a daily chart and accessible snapshot table.
`report` exports the same view as an offline, read-only private HTML file; the
running local browser remains illustrative. Snapshot collection has no new cron.

An optional [Sandbox API integration suite](sandbox-testing.md) is available via
`npm run test:sandbox`, with a separate manual GitHub Actions workflow. All five
integration tests have passed against Plaid Sandbox using explicit simulated
accounts, including local Hosted Link creation/retrieval, share-receipt review and
frozen historical valuation. Initial Sandbox transaction history is allowed to
settle before injecting the checking fixture to avoid an initialization race. These
are additional to the credential-free tests above; real institution validation
remains an external feasibility gate.
