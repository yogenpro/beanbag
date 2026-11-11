import { api } from "./api";

type LinkSession = { linkToken: string; updateMode: boolean };
type LinkHandler = { open: () => void; destroy: () => void };
type PlaidWindow = Window & {
  Plaid?: { create: (options: Record<string, unknown>) => LinkHandler };
};
const storageKey = "beanbag-pending-link";

async function loadLink(): Promise<NonNullable<PlaidWindow["Plaid"]>> {
  if ((window as PlaidWindow).Plaid) return (window as PlaidWindow).Plaid!;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Plaid Link could not load"));
    document.head.appendChild(script);
  });
  if (!(window as PlaidWindow).Plaid)
    throw new Error("Plaid Link did not initialize");
  return (window as PlaidWindow).Plaid!;
}

/** Only the short-lived client Link token is kept for institution OAuth redirect.
 * Access/Item tokens never enter browser storage.
 */
export async function openPlaidLink(
  onSuccess: () => void,
  onError: (message: string) => void,
  resume = false,
): Promise<void> {
  let session: LinkSession;
  if (resume) {
    const stored = sessionStorage.getItem(storageKey);
    if (!stored)
      throw new Error(
        "The Link session expired. Start account authorization again from Data health.",
      );
    session = JSON.parse(stored);
  } else {
    session = await api<LinkSession>("/api/admin/link-token", {});
    sessionStorage.setItem(storageKey, JSON.stringify(session));
  }
  const plaid = await loadLink();
  const handler = plaid.create({
    token: session.linkToken,
    ...(resume ? { receivedRedirectUri: window.location.href } : {}),
    onSuccess: async (
      publicToken: string,
      metadata: { accounts: { id: string }[] },
    ) => {
      try {
        await api(
          session.updateMode
            ? "/api/admin/link-complete"
            : "/api/admin/exchange",
          session.updateMode
            ? {}
            : {
                publicToken,
                selectedAccountIds: metadata.accounts.map((a) => a.id),
              },
        );
        sessionStorage.removeItem(storageKey);
        if (resume) history.replaceState(null, "", window.location.pathname);
        onSuccess();
      } catch (error) {
        onError((error as Error).message);
      } finally {
        handler.destroy();
      }
    },
    onExit: (error: unknown) => {
      sessionStorage.removeItem(storageKey);
      handler.destroy();
      if (resume) history.replaceState(null, "", window.location.pathname);
      if (error)
        onError(
          "Account authorization was not completed. Try again from Data health.",
        );
    },
  });
  handler.open();
}
