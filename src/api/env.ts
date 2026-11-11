import type { LedgerRepository } from "../data/repository";
export type Env = {
  ASSETS: Fetcher;
  DB?: D1Database;
  LOCAL_DEMO?: string;
  APP_ORIGIN?: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
  ADMIN_EMAILS?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  CHECKING_ACCOUNT_MASK?: string;
  BROKERAGE_ACCOUNT_MASK?: string;
  PLAID_WEBHOOK_URL?: string;
  PLAID_REDIRECT_URI?: string;
};
export type Actor = { id: string; email: string; admin: boolean };
export type AppContext = {
  Bindings: Env;
  Variables: { actor: Actor; ledger: LedgerRepository; demo: boolean };
};
