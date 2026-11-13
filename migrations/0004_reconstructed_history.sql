-- Derived estimates remain separate from institution-reported history.
CREATE TABLE account_value_reconstructions (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  as_of_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method = 'reconstructed'),
  value_json TEXT NOT NULL,
  PRIMARY KEY(account_id, as_of_date, method)
);
