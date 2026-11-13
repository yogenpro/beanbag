-- Provider-dated history is separate from immutable collection-time observations.
CREATE TABLE account_value_history (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  as_of_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('institution_export','plaid_assets')),
  value_json TEXT NOT NULL,
  PRIMARY KEY(account_id,as_of_date,method)
);
