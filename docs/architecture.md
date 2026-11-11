# Accounting and ingestion

The pure `src/accounting` modules take normalized source records, a two-account
boundary, optional historical valuations, and durable user decisions. They have
no Cloudflare/Plaid/React imports and can later run against a Node/SQLite adapter.

```text
Access → Worker authentication → Hono API → D1 repository
                                  ↓              ↑
                            React dashboard   Sync service
                                                 ↑
                                    Plaid client / normalization
                                                 ↑
                                       verified webhook / cron
```

## Source and decision identity

`bank:<provider transaction ID>` and `investment:<provider transaction ID>` are
stable event keys. The account IDs come from the new independent Plaid Item,
not another product's connection. Exactly one account per role is stored.
Every ingested source retains allowlisted raw evidence and a normalized record.
Source revisions hash normalized accounting inputs. Raw metadata changes alone
do not discard a decision; changes to normalized evidence require review.

Rules prefer a matching user override, then explicit account evidence, unique
transfer matching with shared stable reference, then narrowly recognized
brokerage transfer descriptions. Equal amount and nearby date alone are never
sufficient. Unexplained brokerage movement goes to review; ordinary checking
credits/debits follow the requested cash boundary. The matcher is ready for
verified provider evidence; the Plaid adapter intentionally does not manufacture
cross-product references that the feed does not supply.

## Atomic publication

Checking synchronization requests the selected account's own incremental stream
(`options.account_id`) and stages **all** pages before one D1 batch transaction
publishes normalized sources, events, removals and the next cursor. A pagination
mutation discards staged pages and restarts from the original durable cursor.
Pending replacements tombstone the pending ID. Repeated data is an upsert.

Investment polling uses a rolling 90-day overlap, a selected-account filter,
stable IDs and explicit cancellation handling. Complete windows tombstone
disappeared provider records; manual evidence is preserved. A changed count or
duplicate during pagination aborts reconciliation. Historical backfill uses the
same service with explicit start/end windows of at most 366 days. There is no
automatic inference of completeness before the rolling window, nor a scheduled
full-history audit in this milestone.

Per-product leases prevent overlapping fetches. A singleton ledger revision
uses compare-and-swap inside each publication transaction, so a concurrent sync
or review cannot silently overwrite newer classification. Failed guards abort
the whole batch. The next cron or explicit sync retries from the durable cursor;
interactive clients reload before retrying a conflicting decision.

The current Worker caps a staged sync at 5,000 changes/100 pages and uses one
atomic batch. An oversized initial history fails visibly without cursor advance;
a staging-table/chunked import is a future extension. Reports currently load
the small household ledger in memory. These choices are appropriate for a
prototype and must be measured before a large backfill or long-lived deployment.

## Stock receipts and historical prices

Plaid investment transfers are unverified candidates. Buys, sells, cash dividends,
interest, splits and reinvestments are excluded. A receipt needs stable security
identity, exact positive quantity, incoming direction, external-origin evidence
and the last unadjusted USD trading-session close on/before arrival.

`HistoricalPriceProvider` defines the adapter boundary. The first adapter accepts
reviewed historical evidence with price/source/session date; no current quote
fallback exists. Quotes more than seven calendar days before arrival require
manual investigation rather than silently accepting a stale price. The reviewer
must verify session completeness; the app does not ship an exchange calendar or
licensed automatic historical feed. Original valuations are retained in the price
registry and decision history. A deliberate correction creates a new decision.

Manual receipts need a stable reference and, when known, the actual Plaid
transaction ID. A later sync of that ID updates the same source and raises a
revision conflict. An exact account/date/security/quantity match across distinct
manual/provider records blocks confirmed stock income until duplicates are
resolved. If the security ID itself changes, human reconciliation is necessary;
there is no automatic remapping based solely on holdings.

## Coverage and failure handling

Checking and investments retain separate attempts, successes, most recent posted
dates, queried-window start, safe error code and coverage limitation. Complete
through is unknown unless explicitly established. No successful webhook or cron
claims the bank is instantly up to date. Revocation/expiry Item signals change
connection status; repair uses Plaid update mode and verifies the selected IDs.

The manual request queue is durable. Verified webhooks queue work and request an
immediate background attempt; scheduled runs reconcile both products after missed
webhooks or interrupted requests. A cron must be installed by private infra.
Worker request-lifetime/CPU limits and historical batch size remain live-spike
validation items; an external queue is not provisioned here.
