# Implementation checklist

Beanbag counts movement across a boundary of exactly two explicitly selected
accounts: joint checking and joint brokerage. It is a reporting convention,
not tax income, net worth, or credit-card purchase accounting.

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
the only implemented persistence adapter; a VPS adapter is deliberately deferred.

## Verification

The local implementation passes 93 accounting, ingestion, SQLite persistence,
Access/CSRF/encryption/webhook, credential isolation and publication-guard tests,
plus four browser tests across desktop and
mobile. Type checking, production UI build, Worker dry run, real local D1
migration and public-source privacy scanning pass. Browser testing includes
source drilldowns, preview/save/reload of reviews, date controls, pending preview,
receipt form, data health, and no horizontal page overflow.

Real Plaid consent, a genuine incoming security receipt, an entitled automatic
historical-price feed, private Access policy provisioning, and live backup/restore
remain external or later operating-milestone work. Reviewed historical quotes
and manual receipts are the implemented fallback; no live financial automation
or deployment is claimed by the synthetic checks.

An optional [Sandbox API integration suite](sandbox-testing.md) is available via
`npm run test:sandbox`, with a separate manual GitHub Actions workflow. All four
integration tests have passed against Plaid Sandbox using explicit simulated
accounts, including share-receipt review and frozen historical valuation. These
are additional to the credential-free tests above; real institution validation
remains an external feasibility gate.
