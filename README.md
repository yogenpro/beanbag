# Beanbag

A private, standalone household ledger for **two selected accounts**: joint
checking and joint brokerage. React + TypeScript, a Hono Cloudflare Worker,
D1/SQLite, independent Plaid authorization, and Cloudflare Access.

The public repository contains portable code and invented test/demo records.
Deployment identities, household account selection, credentials, financial data,
and infrastructure policies stay private. There is no ChatGPT runtime dependency.

The dashboard is **strictly read-only**: Overview, Activity, Projections, and Data health.
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
same date; missing values are not filled with zero. Older brokerage gaps can use
explicitly labelled daily estimates reconstructed from complete activity and
historical closes under a same-day settlement convention. Reported balances
take precedence. Changes
include market moves and external flows, not just investment returns. Stock
receipt income remains fixed at its reviewed historical value.

Imported history lives in `account_value_history` (migration
`0003_account_history.sql`), separate from immutable balance observations and
financial events. The latest value remains independent of the reporting period.
Derived estimates live separately in `account_value_reconstructions` (migration
`0004_reconstructed_history.sql`). The portable replay includes trades, dividends,
interest and fees for balance calculations, while income/expense rules remain
unchanged. It uses exact share quantities, as-traded closes with later splits
reversed, actual share splits and the previous close on non-trading days. Sparse
money-fund prices require explicit issuer transaction-NAV evidence. Price gaps,
short positions and incomplete inputs fail instead of inventing a balance.
Net cash already includes cash debits, so borrowing is never deducted twice.
Private operator tooling retains raw price responses, replayed positions,
statement comparisons and evidence hashes; there is no browser import control
or new background price job.

## Future projections

Projections starts from the latest saved combined net value and runs entirely in
the browser using the existing read-only report API. Choose a 12-month, 3-year,
5-year or Max (default: all available) history window and a 1–30-year horizon.
Cash income and incoming stock transfers form combined income; cash payments
and outgoing stock transfers form expenses. Set their monthly starting baselines,
annual growth rates and annual growth uncertainty independently of investment
returns. Income compounds: 5% annual growth means ×1.05 after one year and
×1.1025 after two. The graph switches between account value and monthly income,
each with a median and selectable 50%, 80% or 95% modeled outcome band.

Monthly baselines use the most recent usable year (up to 12 months, at least
three), rather than a multi-year average that dilutes an existing trend. Only
whole calendar months inside both products' loaded transaction windows and free
of unresolved flows qualify. Known zero-flow months count; missing months do not.
The latest balance's month is excluded. Annual growth uses complete,
non-overlapping 12-month blocks aligned to that month. Each growth observation
compares adjacent annual blocks; missing years are never bridged. The rate is
the geometric mean of year-over-year factors, and uncertainty is their sample
standard deviation in log space. A rate requires two complete annual blocks;
uncertainty requires three. Zero-total annual blocks make the affected geometric
estimate undefined. Insufficient evidence withholds defaults and allows explicit
manual assumptions. Few annual comparisons are prominently disclosed.

Saved share-transfer values and the existing accounting boundary remain intact.
Internal transfers, trades, dividends, interest and fees are excluded from
contributions. Investment growth still uses daily-linked time-weighted returns,
requiring every daily net balance and the prior month-end; it is separate from
income growth. The income graph works without investment or expense assumptions.

The model simulates 1,000 repeatable paths. Each projection year draws independent
normal log-growth factors for income and expenses and compounds their monthly
equivalents for 12 months. Cash and stock income share the income growth factor;
their starting mix stays fixed. Monthly income is added to account value and
expenses subtracted at month-end, alongside independent monthly investment
returns. Growth applies to positive account values; negative values indicate an
unfunded shortfall, without an assumed borrowing rate. Values are nominal, without
inflation adjustment. Bands reflect historical annual variation conditional on
selected parameters; they do not establish guaranteed confidence coverage or
include uncertainty in estimated parameters. Within-year seasonality, correlations
between income/expenses/markets, changing allocations and future tax changes are
not modeled. Past growth may not persist.

Inputs stay in browser memory across dashboard tabs and reset on page reload.
There are no server writes, cookies or local-storage scenario records. Model
methods, actual annual-block dates, keyboard month inspection and annual tables
are available in the tab. No source record or historical share value is revalued.

## Historical value change and returns

The balance view also explains the selected period's change as **income minus
expenses plus estimated investment gain/loss**. It compares net values using the
previous day's balance when available, includes flows after the opening value
through the ending date, and names any shorter comparison window. External cash
and shares use their existing recorded valuations; internal transfers stay
excluded. The investment figure is a dollar residual that includes dividends,
interest, fees and valuation/timing differences, not a performance rate or taxable
gain. Missing transaction windows or unresolved external flows leave the split
unavailable rather than attributing unexplained movement to investments. This
read-only calculation changes no source record, saved balance or income total.

Time-weighted return appears beside the dollar gain/loss as a daily estimate for
the same comparison dates. Each daily growth factor is `(ending net value +
external outflows) / (opening net value + external inflows)`; the period return
is the product of those factors minus one. Incoming cash/shares start the day,
outgoing cash/shares end it. Cumulative TWR sits inline with investment gain/loss.
For comparisons longer than one calendar year, annualized TWR is also shown as
`(1 + cumulative TWR) ** (365 / elapsed days) - 1`. Use the actual covered dates,
including any shorter available comparison; a one-year or shorter comparison
is never annualized, including a calendar year with a leap day. This follows a
[documented daily flow convention](https://help.portfolio-performance.info/en/concepts/performance/time-weighted/)
and [geometric linking of subperiod returns](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/).
Missing daily values, unresolved flows and undefined capital bases withhold the
percentage independently of the dollar estimate. Reconstructed values, saved
flow dates and transfer-price differences affect accuracy; this is not a claim
of exact intraday or standards-certified performance.

Expense categories use saved provider detail where available: Plaid's broad
loan-payment category includes credit-card payments. Specific credit-card and
other-payment details receive matching labels without changing expense amounts.
Selecting a breakdown row opens only the confirmed records with that event kind
and category. The active category is visible and can be cleared in Activity.

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
