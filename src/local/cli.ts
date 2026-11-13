import { join } from "node:path";
import { readFileSync } from "node:fs";
import { balancePage } from "./balance-page";
import { assertPeriod, periodFor } from "../accounting/dates";
import { report } from "../accounting/report";
import { balanceReport } from "../accounting/balances";
import { collectBalances } from "../providers/plaid/balances";
import { PlaidClient, ProviderError } from "../providers/plaid/client";
import { decryptToken } from "../providers/plaid/secrets";
import { SyncService } from "../providers/plaid/sync";
import { loadLocalConfig } from "./config";
import { LocalError, replacePrivate } from "./files";
import { beginLink, cancelLink, completeLink, connection } from "./link";
import { openLocalStore } from "./store";

const help = `Beanbag private local integration (Node 24+, no listening server)

npm run local -- check-config            Validate private settings; no writes or network
npm run local -- connect                 Create/resume owner-operated Hosted Link consent
npm run local -- complete-link           Retrieve consent and validate the two-account boundary
npm run local -- cancel-link             Discard unfinished consent or retry pending Item cleanup
npm run local -- sync                    Reconcile transactions and save a balance snapshot
npm run local -- balances                Save a balance snapshot from existing product data
npm run local -- balances --confirm-no-borrowing  Attest zero brokerage borrowing for this snapshot only
npm run local -- status                  Show connection and product health, without amounts
npm run local -- report [START END]      Write private evidence.json (month by default)

Use ~/.config/beanbag/plaid.env or BEANBAG_LOCAL_ENV_FILE.
See docs/local-integration.md for private storage, consent and recovery.
`;

export async function main(
  args: string[],
  project: string,
  env: NodeJS.ProcessEnv = process.env,
  output: (text: string) => void = (text) => process.stdout.write(text),
): Promise<number> {
  try {
    if (
      !args.length ||
      (args.length === 1 && ["help", "--help"].includes(args[0]))
    ) {
      output(help);
      return 0;
    }
    const command = args[0] === "--check-config" ? "check-config" : args[0];
    if (
      ![
        "check-config",
        "connect",
        "complete-link",
        "cancel-link",
        "sync",
        "balances",
        "status",
        "report",
      ].includes(command) ||
      (args.length !== 1 &&
        !(command === "report" && args.length === 3) &&
        !(
          command === "balances" &&
          args.length === 2 &&
          args[1] === "--confirm-no-borrowing"
        ))
    )
      throw new LocalError(
        "Unknown command or arguments. Run npm run local -- help.",
      );
    let period = periodFor("month");
    if (command === "report" && args.length === 3) {
      try {
        period = assertPeriod({ start: args[1], end: args[2] });
      } catch {
        throw new LocalError(
          "Use a valid inclusive report period: YYYY-MM-DD YYYY-MM-DD.",
        );
      }
    }
    const config = loadLocalConfig(project, env);
    if (command === "check-config") {
      output(
        `Private ${config.environment} settings are valid; no files were written and no network requests were made. Product entitlement and bank consent remain unverified.\n`,
      );
      return 0;
    }
    const store = openLocalStore(config);
    try {
      // The overall API budget also bounds a slow/multi-page provider response.
      const deadline = Date.now() + 180_000;
      const api = new PlaidClient(
        config.clientId,
        config.secret,
        config.environment,
        async (input, init) => {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new ProviderError("LOCAL_RUN_TIMEOUT");
          return fetch(input, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(remaining),
              ...(init?.signal ? [init.signal] : []),
            ]),
          });
        },
      );
      if (command === "connect") {
        const url = await beginLink(store, api);
        output(
          `Open this private, short-lived Plaid consent link in your browser. Select exactly the configured checking and brokerage accounts. Do not share the link or capture it in public logs:\n${url}\nThen run npm run local -- complete-link.\n`,
        );
      } else if (command === "complete-link") {
        const result = await completeLink(store, api, config);
        output(
          result === "connected"
            ? "The selected checking/brokerage pair is connected. Run sync to ingest records; consent alone does not establish coverage.\n"
            : result === "pending"
              ? "No completed consent is available yet. Finish the saved link and retry complete-link; no polling job is running.\n"
              : "Pending Item cleanup completed. No account boundary was connected.\n",
        );
      } else if (command === "cancel-link") {
        await cancelLink(store, api);
        output(
          "Pending local Link state cleared. Close the old consent link; it must not be completed after cancellation.\n",
        );
      } else if (command === "sync" || command === "balances") {
        const item = await connection(store);
        if (!item || item.status !== "connected")
          throw new LocalError(
            "Complete independent Link consent before syncing.",
          );
        const token = await decryptToken(
          item.encrypted_token,
          store.key,
          item.id,
        );
        const sync = new SyncService(api, store.repo, token);
        let failed = false;
        for (const product of command === "sync"
          ? (["checking", "investments"] as const)
          : []) {
          try {
            const result = await sync[product]();
            output(
              `${product}: ${result}; complete-through date remains unknown.\n`,
            );
            if (result !== "success") failed = true;
          } catch {
            output(
              `${product}: failed; inspect status for the safe error code.\n`,
            );
            failed = true;
          }
        }
        try {
          await collectBalances(
            api,
            store.repo,
            token,
            () => new Date(),
            args.includes("--confirm-no-borrowing")
              ? { actor: store.actor, confirmedAt: new Date().toISOString() }
              : undefined,
          );
          output(
            "balances: saved a snapshot; institution balances may be cached.\n",
          );
        } catch {
          output(
            "balances: failed; previous snapshots preserved. Inspect status for the safe error code.\n",
          );
          failed = true;
        }
        return failed ? 1 : 0;
      } else if (command === "status") {
        output(
          `Local ${config.environment} ledger: ${(await connection(store)) ? "connected" : "not connected"}.\n`,
        );
        output(
          `Link session: ${(await store.session()) ? "pending" : "none"}.\n`,
        );
        for (const health of await store.repo.coverage()) {
          const code =
            health.error && /^[A-Z_]+$/.test(health.error)
              ? health.error
              : health.error
                ? "SYNC_FAILED"
                : "none";
          output(
            `${health.product}: last success ${health.lastSuccess ?? "never"}; error ${code}; complete-through unknown.\n`,
          );
        }
        const balances = await store.repo.balanceHealth();
        output(
          `balances: last success ${balances.lastSuccess ?? "never"}; error ${balances.error && /^[A-Z_]+$/.test(balances.error) ? balances.error : "none"}.\n`,
        );
      } else if (command === "report") {
        const events = await store.repo.events();
        const evidence = {
          generatedAt: new Date().toISOString(),
          environment: config.environment,
          ...report(events, period),
          accounts: await store.repo.accounts(),
          coverage: await store.repo.coverage(),
          sources: await store.repo.sources(),
          events,
          decisions: await store.repo.overrides(),
          valuations: await store.repo.valuations(),
          balances: balanceReport(
            await store.repo.balanceSnapshots(),
            await store.repo.accounts(),
            await store.repo.balanceHealth(),
            period,
          ),
          sourceEvidence: (
            await store.db
              .prepare("SELECT id,raw_json FROM source_records ORDER BY id")
              .all<{ id: string; raw_json: string }>()
          ).results.map((row) => ({
            id: row.id,
            evidence: JSON.parse(row.raw_json),
          })),
        };
        replacePrivate(
          project,
          join(config.stateDirectory, "evidence.json"),
          JSON.stringify(evidence, null, 2) + "\n",
        );
        const css = readFileSync(
          join(project, "src/ui/style.css"),
          "utf8",
        ).replace(/^@import[^;]+;\s*/gm, "");
        const fonts = [400, 500, 600, 700]
          .map((weight) => {
            const bytes = readFileSync(
              join(
                project,
                `node_modules/@fontsource/dm-sans/files/dm-sans-latin-${weight}-normal.woff2`,
              ),
            );
            return `@font-face { font-family: 'DM Sans'; font-style: normal; font-weight: ${weight}; src: url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2'); }`;
          })
          .join("\n");
        replacePrivate(
          project,
          join(config.stateDirectory, "account-values.html"),
          balancePage(evidence.balances, evidence.accounts, fonts + "\n" + css),
        );
        output(
          "Wrote evidence.json and read-only account-values.html in the private local data directory. Open the HTML locally; these files contain financial records and must stay out of Git, screenshots and chat.\n",
        );
      }
      return 0;
    } finally {
      store.close();
    }
  } catch (error) {
    output(
      (error instanceof LocalError
        ? error.message
        : error instanceof ProviderError && /^[A-Z_]+$/.test(error.code)
          ? `Plaid request failed: ${error.code}.`
          : "Local integration failed. Check private settings, file permissions and provider availability; no private error details were printed.") +
        "\n",
    );
    return 1;
  }
}
