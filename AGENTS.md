# Beanbag implementation notes

This is public application source. Keep real financial records, account masks,
household identities, provider tokens, deployment IDs and private infrastructure
configuration out of every commit, issue, fixture and screenshot. The original
implementation handoff is private and must not be added to the repository.

Follow the accounting boundary documented in README.md. External cash and share
transfers into either selected account are income; external cash and share
outflows are expenses. Exclude transfers between the two accounts, pending or
removed entries, brokerage trades, dividends, interest and fees. Credit-card
payments from checking count when paid. Share transfers use exact quantity times
the institution's recorded transfer price, with saved historical-close evidence
as a fallback. Never use a current quote, holdings increase or inferred taxable
income. This is the owner's revised convention from November 12, 2026.

Run `npm run check` for backend changes. After nontrivial UI changes, build first,
then run `npm run test:browser` against that stable build; inspect desktop/mobile
screenshots. Tests and demos use invented records only. The synthetic in-memory
preview is loopback-only; production requires signed Access JWTs and private D1.

Deployment is managed by the separate private `infra` repository. This repo owns
portable code, migrations and assets. Private infra owns deployment identity,
domains, Access policy, D1 containers, cron and orchestration. Do not add production
deployment credentials or a second infrastructure writer here.

See docs/implementation.md for completed work and external feasibility gates.
Read docs/next-steps.md when resuming the project for the verified baseline,
private configuration locations, and ordered next steps.
