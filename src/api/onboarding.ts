import type { Account } from "../accounting/types";
import type { JsonRecord } from "../providers/plaid/client";
/** Fresh connection IDs are discovered from provider response; no ChatGPT account IDs. */
export function selectAccounts(
  available: JsonRecord[],
  selectedIds: string[],
  checkingMask: string,
  brokerageMask: string,
): Account[] {
  if (
    !/^\d{4}$/.test(checkingMask) ||
    !/^\d{4}$/.test(brokerageMask) ||
    checkingMask === brokerageMask ||
    new Set(selectedIds).size !== 2 ||
    selectedIds.length !== 2
  )
    throw new Error("Select exactly two independently linked accounts");
  const checking = available.filter(
    (a) =>
      a.mask === checkingMask &&
      a.type === "depository" &&
      a.subtype === "checking",
  );
  const brokerage = available.filter(
    (a) => a.mask === brokerageMask && a.type === "investment",
  );
  if (
    checking.length !== 1 ||
    brokerage.length !== 1 ||
    !selectedIds.includes(checking[0].account_id) ||
    !selectedIds.includes(brokerage[0].account_id)
  )
    throw new Error(
      "The selected accounts do not match the privately configured boundary",
    );
  return [
    {
      id: checking[0].account_id,
      role: "joint_checking",
      label: "Joint checking",
      mask: checkingMask,
    },
    {
      id: brokerage[0].account_id,
      role: "joint_brokerage",
      label: "Joint brokerage",
      mask: brokerageMask,
    },
  ];
}
