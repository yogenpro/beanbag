# Private deployment, backups and repair

Public CI runs credential-free application checks. After a trusted main push
passes, it verifies the current branch head and requests a fixed-main Cloudflare
build using the encrypted `BEANBAG_DEPLOY_HOOK` capability. The request helper
rejects forks/other refs, skips superseded commits, withholds provider errors and
does not forward its GitHub token to Cloudflare. Cloudflare deployment is
orchestrated by private infra using the checked-build/private-adapter pattern.
No Cloudflare API credential is installed in the public repository. Do not copy
infrastructure tokens, account IDs, hostnames, Access policy or database identities
into this repository. The private adapter must reject unapproved schema changes;
apply migrations after the required backup/recovery review before updating that
approval. Automatic application releases do not enable provider polling.

## Deployment checklist

1. Build the exact intended commit in a disposable checkout with `npm ci` and
   `npm run check`; run the browser suite. No infrastructure credentials are
   needed for those checks.
2. The private adapter preserves `main`, assets, compatibility date and migration
   directory; injects the `DB` container and private configuration; removes the
   illustrative local environment; and keeps alternate ingress disabled.
3. Bootstrap the Worker with closed ingress. Create the Access gate before
   attaching the custom domain. The entire domain is private except the exact
   signature-protected webhook callback. Never bypass the whole application.
4. Set private Worker secrets and approve both individual identities. Apply D1
   migrations via the private adapter, after taking an encrypted backup for an
   existing database. Configure an hourly (or agreed) cron.
5. Deploy the checked commit with the private build/deploy credential. Terraform
   owns domains, Access and D1 container identity; Wrangler owns application
   uploads/assets and bindings. Avoid two writers for these resources.
6. Test anonymous root, static asset and `/api/report`: none may return financial
   data. Verify logged-out, third-party, and both intended identities interactively.
   Verify wrong audience/expired/unsigned JWTs cannot access handlers; ensure no
   enabled workers.dev or preview URL bypasses the gate. Verify every dashboard mutation returns 405, even for the owner.
7. Complete the independent Plaid spike and verify last successful sync for both
   products, read-only source/history drilldowns and coverage gaps. Confirm the
   runtime calls only the host's Access/Plaid services and contains no ChatGPT
   service dependency. Automatic share-income coverage remains unverified until
   a real incoming receipt is tested.

## Encrypted database backup

The live reporting ledger is private D1, accessed through the Worker binding.
It contains transactions/raw source evidence, classifications, valuations,
balance observations/history and encrypted provider Item tokens. Worker secrets
hold the separate token-encryption key and provider credentials. Public source
and CI fixtures contain invented data. Local import PDFs/CSVs, price evidence,
private reports and the legacy SQLite ledger remain separate from hosted D1;
they are not an automatic replica of its current state.

Cloudflare provides [managed encryption at rest and in transit](https://developers.cloudflare.com/d1/reference/data-security/).
Financial rows are readable by the application and authorized operators; this
is not end-to-end encryption. Access sign-in, signed JWT verification, disabled
alternate ingress and read-only routes reduce exposure. Privileged Cloudflare,
identity-provider, repository and local-device access still matter. Code merged
to main can become production code, so repository write access is part of the
trust boundary. Protect these accounts with MFA and keep credentials private.

D1's [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
is automatic for production databases. Its current retention
[depends on the Workers plan](https://developers.cloudflare.com/d1/platform/limits/):
seven days on Free or thirty on Paid. This is a rollback layer within the same
provider/account, not an independent off-device archive of local evidence/keys.
Verify actual availability and the applicable plan; never infer a recovery test
from the presence of a bookmark.

Private operator tooling can also create AES-256-GCM archives with an independent
backup key, recover them into isolated SQLite, check integrity/foreign keys and
compare every managed table fingerprint. Include all currently managed tables,
including derived account history; retain the precise scope in a private receipt.
These archives omit runtime secrets, and a local restore does not establish a
hosted disaster-recovery cutover. Off-device recovery must cover the encrypted
database, original import/price evidence, backup-decryption key and provider-token
encryption key. Keep keys separate from archives and verify their recoverability.

Run these only from the private, authenticated operator environment. Set
`BEANBAG_PRIVATE_CONFIG` to the disposable private Wrangler configuration and
`BEANBAG_BACKUP_RECIPIENT` to the approved `age` public recipient. Install `age`
using the operator's normal tooling. Avoid a plaintext SQL file:

```sh
umask 077
set -o pipefail
npx wrangler d1 export DB --remote --config "$BEANBAG_PRIVATE_CONFIG" --output /dev/stdout \
  | age --recipient "$BEANBAG_BACKUP_RECIPIENT" > "$BEANBAG_ENCRYPTED_BACKUP"
```

Wrangler's stdout format must be checked using a **synthetic staging database**
before trusting this pipeline: wrappers/logging differ by release. Use the
private controller's verified export path if clean stdout is unavailable.
Verify encryption/decryption and record the export timestamp, app commit and
migration version privately. No plaintext exports in the app checkout, CI
artifacts, public issues or logs. Back up the token encryption key separately,
under an independently recoverable secret-management policy.

## Restore rehearsal

1. Provision a separate, private D1 recovery container through infra, with no
   attached public endpoint or scheduled sync. Do not restore over production.
2. Decrypt into an owner-only temporary directory on encrypted local storage.
   D1 SQL import currently requires a file; keep its contents out of terminal
   output and ensure the operator has approved this deliberate private export.
3. Execute the SQL into that isolated container using the private Wrangler config.
   Import an exported schema **instead of** applying a second copy of the initial
   migration. Restore the separate encryption key in recovery Worker secrets.
4. Verify account selection, event/override/price counts, integer-cent totals for
   known periods, original valuation provenance and cursor state. Compare with
   the recorded private backup receipt. Test representative source drilldowns.
5. Require an explicitly reviewed cutover before routing users or enabling sync.
   Remove the temporary plaintext according to the encrypted-storage retention
   procedure. No deletion or live restore is automated by this project.

The generic export procedure is not itself evidence of a completed restore.
Private receipts must identify the tested archive, table scope and recovery
environment. A backup is not recovery proof until an isolated restore passes.

## Repair

- **Consent/revocation:** use private operator recovery for the owning Item.
  Hosted repair tooling is pending; the dashboard has no Link or repair controls.
  Account ID changes require reconciliation and must never silently select a new
  account. Consent and successful ingestion are separate checks.
- **Failed sync:** inspect the safe code and last successful product timestamp.
  Correct the private configuration through operator tooling and run ingestion;
  the durable checking cursor does not advance after a failed batch. Configured
  scheduled runs also retry. Dashboard refresh only reloads saved data.
- **Changed source after review:** the dashboard shows the preserved history and
  current evidence. Any correction must use the private operator integration and
  repository revision checks, preserving the old decision in the audit log.
- **Oversized initial batch:** no partial totals/cursor are published. Use a
  reviewed staging import/chunked-ingestion extension; do not raise limits blindly.
- **Historical investment corrections:** the automated overlap is 90 days.
  Explicitly run additional bounded service windows when reconciling older data.
  There is no public backfill/admin-SQL endpoint.
- **Missing transfer value:** normal incoming/outgoing transfers need no separate
  origin approval. Read the recorded price from the original transaction; if it
  is absent, leave the amount unvalued or supply reviewed historical-close
  evidence through private tooling. Never use today's quote. Source corrections
  and duplicate records remain distinct from normal automatic classification.
