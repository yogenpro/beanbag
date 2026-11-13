# Private local Plaid integration

The opt-in `npm run local -- …` commands implement the local feasibility spike.
They reuse the accounting, normalization, sync and D1 SQL repository through a
Node SQLite adapter. There is no listening server, background polling, public
webhook, automatic pricing, or deployment. The browser demo still uses invented
in-memory records, and the production Worker still requires signed Access JWTs.

Use Node 24+ on Linux/macOS or a POSIX environment such as WSL. Install the
committed dependencies with `npm ci`.

## Private configuration

Fill in `~/.config/beanbag/plaid.env` locally. Do not paste the values into chat,
shell arguments, source files or logs:

```dotenv
PLAID_ENV=production
PLAID_CLIENT_ID=replace_locally
PLAID_SECRET=replace_with_production_secret_locally
CHECKING_ACCOUNT_MASK=replace_with_selected_checking_last_four
BROKERAGE_ACCOUNT_MASK=replace_with_selected_brokerage_last_four
```

The directory must belong to the operator with mode 0700; the file must have mode 0600. Paths containing symlinks, hard-linked files, other-user-writable ancestors,
and paths inside Git checkouts are refused. Inherited generic `PLAID_*` variables
are ignored. Check the owner's current plan, cost, Transactions and Investments
entitlements, and institution availability in the Plaid dashboard before consent.

```sh
npm run local -- check-config
```

This command only checks local configuration. It makes no requests and creates no
data or key files; it does not prove credentials or product access are valid.

| Override                  | Default                                               |
| ------------------------- | ----------------------------------------------------- |
| `BEANBAG_LOCAL_ENV_FILE`  | `~/.config/beanbag/plaid.env`                         |
| `BEANBAG_LOCAL_STATE_DIR` | `~/.local/share/beanbag/<sandbox-or-production>`      |
| `BEANBAG_LOCAL_KEY_FILE`  | `~/.config/beanbag/local-<sandbox-or-production>.key` |

The first operational command creates the private SQLite ledger and a random
32-byte encryption key. The key and credential file must be outside the data
directory. The database is bound to the environment, client ID, configured account
masks and encryption key; changing those refuses reuse of the ledger. Rotating
the Plaid secret does not change its identity. Use separate data and key paths
for a different account boundary or environment. Never repurpose the demo's D1
files or a production D1 export as the local ledger.

The database and evidence report contain plaintext financial records inside an
owner-only directory; use encrypted local storage. Item tokens and pending Link
state are AES-GCM encrypted with the separately stored key. Back up the key
separately. A missing or wrong key for an existing ledger is an error; the tool
does not silently create a replacement key or reset the database.

## Independent consent

```sh
npm run local -- connect
```

Open the short-lived private Plaid Hosted Link URL printed in your terminal.
The account owner completes the consent and selects exactly the configured
checking and brokerage accounts. Keep the URL private. The command requests
Transactions and Investments together and disables multi-Item Link. Plaid hosts
the bank redirects; this CLI does not expose a callback or require localhost TLS.
An existing connection in another app supplies no reusable consent or token.

After consent, run:

```sh
npm run local -- complete-link
```

The command retrieves the saved session once with `/link/token/get`, exchanges
its public token server-side, fetches fresh account IDs and checks the exact
two-account selection against private masks. It persists only the selected pair.
Incomplete consent remains pending; no polling process continues after exit.
Run `connect` again to retrieve the same unexpired URL instead of creating another
session. Complete the retrieval promptly: Plaid documents six hours of completed
session detail availability.

If `/accounts/get` fails after exchange, the encrypted Item token is retained so
`complete-link` can retry without reusing the one-time public token. A mismatched
account boundary attempts to remove the new Item. If removal fails, the encrypted
pending token remains available for a later `complete-link` cleanup attempt.
If a process dies during the exchange before its token is saved, reconcile/revoke
the orphaned connection in Plaid before creating another one.

`cancel-link` checks that an unexchanged session has no completed consent before
clearing it, or removes a pending exchanged Item. It cannot revoke a Hosted Link
URL itself: close the old browser flow and never complete it after cancellation.
It refuses to disconnect an established ledger connection. An already connected
ledger refuses `connect` to prevent duplicate Items. Local update-mode repair is
not implemented in this bounded spike; arrange private operator recovery for the
Item owned by that deployment. The dashboard has no consent or repair controls.

## Sync and reconcile privately

```sh
npm run local -- sync
npm run local -- status
npm run local -- report
npm run local -- report 2026-08-01 2026-08-31
```

`sync` attempts checking and investments independently. It preserves the existing
5,000-record/100-page staging limits, atomic checking cursor updates, 90-day
investment overlap, per-request timeout and review conflict rules. The local run
also has a three-minute total provider request budget. A failed/busy product makes
the command exit unsuccessfully without claiming complete coverage.

It also collects a balance snapshot independently of the transaction products.
`npm run local -- balances` collects only balances, using the existing authorized
products. Each snapshot uses its reported assets and margin borrowing to calculate
net worth automatically. No borrowing confirmation flag is required or supported;
legacy attestation metadata is preserved but does not override reported balances.
No unattended collection is enabled by these commands. Future explicit syncs
and the hosted scheduled entry point collect new observations when run.

Existing local ledgers migrate from version 1 to version 2 transactionally, after
their configuration/key checks, preserving sources, decisions and credentials.
Private infra must apply both portable migrations before running the new Worker.

`status` shows environment, connection/session presence, product success times
and safe error codes. It does not print account IDs, masks, amounts or source
payloads. The other commands similarly suppress private exception details.

`report` atomically replaces `evidence.json` in the private data directory. It
contains totals for the inclusive date range, normalized sources, stored raw
evidence, events, decisions, original valuations, balance history and coverage. The evidence lists
include the whole local ledger even when totals use a narrower period. It omits
credentials and tokens. Read it locally; do not commit it, attach it to public
issues, copy it into chat, or capture it in browser test artifacts.

It also writes `account-values.html` (0600), a read-only view of the actual saved
balances and period history. Open that file in a local browser. It embeds the
existing font/style assets, has no scripts or network requests, and does not
start a server or change Access policy. Regenerate it after collecting balances
to see new observations; the interactive loopback dashboard remains illustrative.
The complete household net worth is not covered. Resolve provider/owner borrowing
disagreements against the institution before treating the net figure as verified.

Privately reconcile external checking receipts, card payments and internal
transfers. Verify a genuine incoming share receipt's date, quantity, stable
security identity, incoming direction and external origin against institution
evidence when investigating discrepancies. Normal transfers now follow the
owner's external-flow convention without per-event approval and use their recorded
transfer price. Missing price/quantity/identity remains unvalued; current holdings
quotes are not substituted. Feed completeness is a separate feasibility question.

Only one local command may hold `command.lock` at a time. Normal completion
removes the lock. After a crash, verify the process has stopped before manually
removing that file from the private directory. Do not remove an active lock,
delete a ledger to bypass a configuration mismatch, or raise ingestion limits
without investigating the failed batch.

## Sandbox and verification

The credential-free suite uses invented records in temporary private directories
to check encryption, persistence across restart, atomic rollback, config/permission
isolation, Link retries, account mismatch cleanup, cursor preservation and report
privacy. Run `npm run check` after backend changes.

For an interactive Sandbox rehearsal, create a separate private config file with
Sandbox credentials and the masks of the selected simulated accounts, then set
`BEANBAG_LOCAL_ENV_FILE` for the commands. Do not modify the live configuration or
reuse live state. The existing `npm run test:sandbox` remains an independent API
contract suite. Sandbox success does not establish Schwab transfer representation,
plan entitlement, real consent, or complete live coverage.

References: [Plaid Hosted Link](https://plaid.com/docs/link/hosted-link/),
[Link token API](https://plaid.com/docs/api/link/),
[accounting and sync architecture](architecture.md).
