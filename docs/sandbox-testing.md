# Plaid Sandbox integration tests

`npm test` and `npm run check` remain credential-free. The optional
`npm run test:sandbox` suite calls the real **Sandbox API** with simulated
accounts; it never calls Production, opens the live bank connection, or reads
the application's production database. Test code and invented scenarios are
public. Credentials belong in a private local file or GitHub Actions secrets.

## Local credentials

In the Plaid dashboard's API Keys section, copy the client ID and **Sandbox**
secret into `~/.config/beanbag/plaid-sandbox.env`:

```dotenv
PLAID_CLIENT_ID=replace_locally
PLAID_SECRET=replace_with_sandbox_secret_locally
PLAID_ENV=sandbox
```

Use an owner-only directory (0700) and file (0600), outside the checkout. The
existing `~/.config/beanbag/plaid.env` is a separate live-connection template;
leave that file separate. To use another private Sandbox file, set
`BEANBAG_SANDBOX_ENV_FILE` to its path. The runner refuses production-mode files,
repository-local paths, symlinks and unsafe file permissions. It does not use
inherited generic `PLAID_CLIENT_ID`/`PLAID_SECRET` variables.

```sh
npm run test:sandbox -- --check-config # checks settings without contacting Plaid
npm run test:sandbox                  # explicit API integration run
```

Only the short-lived Sandbox Item token lives in the test process. The runner
redacts configured credentials and Plaid tokens from output. It saves no provider
payloads, tokens or database files. The suite attempts to remove its simulated
Item after completion, including ordinary test failures.

## What is exercised

The suite bypasses Link using `/sandbox/public_token/create`, as Plaid recommends
for automated tests. It creates one First Platypus Bank Item with Transactions
and Investments and an explicit `user_custom` household: checking, unselected
savings and brokerage. The brokerage contains invented purchases, sales and a
fractional-share receipt. This avoids depending on the default test user's
account mix, which may contain retirement accounts without a brokerage account.
The suite discovers fresh account IDs and uses an isolated in-memory SQLite
database with the real migration/repository.

- Seed external payroll, a card payment, an internal brokerage transfer and
  outbound Zelle through `/sandbox/transactions/create`.
- Seed an unselected savings account and verify its transaction is not ingested.
- Run account-scoped Transactions Sync through normalization and SQLite;
  reconcile exact cents and exclude the internal transfer.
- Rerun sync and preserve an audited manual classification.
- Fetch selected investment history; exclude purchases/sales and leave the
  unverified share receipt in review. Approve a synthetic historical valuation
  and verify that a later sync retains exactly one receipt at that value.
- Force `ITEM_LOGIN_REQUIRED` through `/sandbox/item/reset_login`; verify the
  failure is visible and the durable cursor does not advance.

This is a live API contract suite, with bounded polling for asynchronous data.
Sandbox service/profile changes can fail it independently of the offline unit
tests. It remains separate from the normal pull-request checks. Passing it does
not establish Schwab-specific transfer representation or live feed completeness.
No webhook delivery test is claimed: it needs a separately configured callback.

## Verified execution

The four integration tests passed against Plaid's Sandbox API using the explicit
household fixture. Checking amounts reconciled exactly; the 2.5-share receipt
remained excluded until approval, then retained its invented $150.12 historical
close and $375.30 event value across another investment sync. The simulated
login failure left the checking cursor unchanged. Item removal completed after
the suite. These are Sandbox results, not evidence of live institution coverage.

## GitHub Actions

Add repository secrets named `PLAID_SANDBOX_CLIENT_ID` and
`PLAID_SANDBOX_SECRET`, then manually run the **Plaid Sandbox** workflow on
`main`. Secrets are passed only to that opt-in test step. Fork pull requests and
the normal Check workflow receive no Plaid credentials. Do not commit API keys
or run this workflow against unreviewed source with secrets.

## References

- [Sandbox overview and automated testing guidance](https://plaid.com/docs/sandbox/)
- [Sandbox API endpoints](https://plaid.com/docs/api/sandbox/)
- [Sandbox institutions](https://plaid.com/docs/sandbox/institutions/)
- [Custom Sandbox accounts and investment transactions](https://plaid.com/docs/sandbox/user-custom/)
- [Plaid API-key security](https://plaid.com/docs/account/security/)
