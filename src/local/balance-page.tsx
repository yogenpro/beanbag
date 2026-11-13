import { renderToStaticMarkup } from "react-dom/server";
import type { BalanceReport } from "../accounting/balances";
import type { Account } from "../accounting/types";
import { AccountValue } from "../ui/account-value";

/** Read-only offline view. React escapes provider text; no scripts or network requests. */
export function balancePage(
  data: BalanceReport,
  accounts: Account[],
  css: string,
): string {
  const markup = renderToStaticMarkup(
    <div className="private-balance-page">
      <main>
        <div className="page-heading">
          <div>
            <h1>Tracked accounts</h1>
            <p className="subtitle">
              Private saved report. Regenerate the report to see newly collected
              balances.
            </p>
          </div>
        </div>
        <AccountValue data={data} accounts={accounts} interactive={false} />
      </main>
    </div>,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><title>Beanbag · Private account values</title><style>${css.replaceAll("</style", "<\\/style")}\n.private-balance-page main { margin: 0 auto; width: 100%; max-width: 1080px; padding: 32px 24px; }\n@media(max-width: 700px) { .private-balance-page main { padding: 24px 16px; } .private-balance-page .page-heading { display: block; } }</style></head><body>${markup}</body></html>`;
}
