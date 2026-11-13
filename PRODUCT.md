# Beanbag

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Household members reviewing shared income and spending across one selected
checking account and one selected brokerage account. Product facts here come
from the repository's README and AGENTS.md and the owner's implementation brief.

## Product Purpose

Explain what entered the household, what left checking, and what moved between
the two accounts, alongside their latest value and saved balance history.
Every reported amount must lead back to its records and
classification evidence.

## Operating Context

The dashboard is strictly read-only. It supports period comparisons, transaction
drilldowns, saved stock valuations, and independent data-health checks. Ambiguous
entries are informational exclusions, not a user task queue. It is a responsive
browser application. The local browser preview uses
invented records; the separate private integration ledger is not its data source.

## Capabilities and Constraints

- Posted external checking receipts are cash income. Checking payments,
  including credit-card payments when paid, are spending.
- Incoming external shares are recorded separately as in-kind income using exact
  quantity times a historical arrival-date close. They are neither cash income
  nor an inferred tax figure.
- Pending and unresolved records stay outside confirmed totals. Internal cash
  transfers, investment trades, and brokerage dividends are excluded.
- A successful sync does not establish complete reporting coverage.
- On November 12, 2026, the owner requested a strictly read-only dashboard for
  simplicity. This supersedes browser classification, receipt-entry, connection
  management and sync controls. Filters, charts, record evidence and refreshing
  the saved view remain available; ingestion/maintenance happen outside the UI.
- On November 12, 2026, the owner requested tracked-account net worth and a chart
  of changes over time. Show only the selected pair, with snapshot freshness and
  borrowing handled explicitly. Market values stay separate from receipt income;
  historical balances must be observed, not inferred from transfers or holdings.
- Public source, fixtures, screenshots, and design artifacts contain no real
  financial records, private identities, credentials, or deployment details.
- Preserve keyboard navigation, accessible labels, responsive layouts, read-only
  record details and period selection.

## Brand Commitments

The product name is Beanbag. The owner rejected the initial dashboard's visual
feel and requested Impeccable for its redesign on November 12, 2026. The owner
selected “Crisp and understated — white, ink, restrained blue” in this session.
After viewing the implementation, the owner said “design looks good now.”

## Evidence on Hand

The working React interface, illustrative in-memory repository, accounting tests,
and desktop/mobile browser tests are available locally. Synthetic amounts
demonstrate behavior and must be clearly labeled. No complete production coverage
claim is established.

## Product Principles

- Make the cash versus in-kind distinction explicit.
- Keep financial totals traceable to records and evidence.
- Show uncertainty and data gaps alongside confirmed information.
- Make viewing household finances simple on both desktop and mobile.
