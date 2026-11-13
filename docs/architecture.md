# Accounting and ingestion

The pure `src/accounting` modules take normalized source records, a two-account
boundary, optional historical valuations, and durable user decisions. They have
no Cloudflare/Plaid/React imports. The [local integration CLI](local-integration.md)
now reuses them and the D1 SQL repository through a Node SQLite adapter. Its
private persistence and encryption key are outside Git; it is a separate entry
point with no production authentication bypass.

The browser is strictly read-only. After Access authentication, dashboard API
routes accept only GET/HEAD; all mutation methods return 405 with no database or
provider effects. Only the exact independently signed webhook path can write via
HTTP. Ingestion also runs through the scheduled entry point or private CLI.
The UI can display existing decision history but cannot create/change decisions,
receipts, connection state or sync jobs. Reconciliation belongs to operator
tooling, with the existing repository revision guards and audit records.

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
operator integrations reload before retrying a conflicting decision.

The current Worker caps a staged sync at 5,000 changes/100 pages and uses one
atomic batch. An oversized initial history fails visibly without cursor advance;
a staging-table/chunked import is a future extension. Reports currently load
the small household ledger in memory. These choices are appropriate for a
prototype and must be measured before a large backfill or long-lived deployment.

## Stock receipts and historical prices

Under boundary-2, external cash/share transfers into either tracked account count
as income and corresponding external outflows as expenses. Unmatched transfers
are external by the owner's reporting convention. Stable counterpart/mask evidence
or unique reciprocal transfer legs identify internal movements; both legs share
a group so excluded amounts are counted once. Ordinary non-transfer payments and
ambiguous matches are not arbitrarily paired. Trades, brokerage dividends,
interest, fees, splits and reinvestments stay excluded.

Shares use exact absolute quantity times the institution's unit price on the
original transfer record, with direction from its signed position movement.
This recorded price has its own valuation convention; it is not labeled a market
close. Missing identity/quantity/direction/price stays outside totals. Older
normalized records recover pricing from their unchanged, lossless raw evidence.
D1 reports and detail views apply current rules to saved evidence without database
writes, so a deployment immediately reclassifies existing records. Derived event
rows remain a sync-time cache rather than the report's rule authority.

`HistoricalPriceProvider` remains the fallback adapter boundary. It accepts
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

Balance observations use separate `balance_snapshots` and `balance_refresh`
tables (migration `0002_balances.sql`). The collector reads selected checking
from `/accounts/get` and selected brokerage from `/investments/holdings/get`;
the latter includes the margin-loan field. Requests use selected account IDs,
and normalization independently filters and checks the returned roles. No
additional holdings sum is added to the institution's total asset value.
Exact decimal balances become integer cents once; brokerage borrowing is
subtracted once. Missing values/currencies are never silently zeroed or converted.

Both responses must validate before publishing one immutable observation and
its success status in a transaction. Failure leaves old snapshots intact with
independent error status; out-of-order attempts cannot replace newer health.
A dated owner attestation supplies zero borrowing for just that observation and
takes precedence over a contradictory provider figure. Both pieces of evidence
remain available; the report identifies the owner confirmation as its borrowing
basis and shows net worth using that basis. Future unconfirmed snapshots use
their own reported/unknown borrowing, never an inherited confirmation.
The original missing provider field and the dated attestation remain distinct.

The API returns the latest snapshot independently of the selected report period,
plus the latest saved observation per Pacific day in that period. A changed
account boundary cannot splice histories. Missing daily samples remain gaps;
there is no historical reconstruction or use of balances as income evidence.
Collection timestamps do not claim real-time institution freshness. These
semantics follow [Plaid Accounts](https://plaid.com/docs/api/accounts/) and
[Investments](https://plaid.com/docs/api/products/investments/). The collector does
not call the paid real-time Balance or Investments Refresh endpoints.

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
