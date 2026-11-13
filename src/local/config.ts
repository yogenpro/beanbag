import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { LocalError, outside, privateLocation, readPrivate } from "./files";

export type LocalConfig = {
  project: string;
  environment: "sandbox" | "production";
  clientId: string;
  secret: string;
  checkingMask: string;
  brokerageMask: string;
  stateDirectory: string;
  keyFile: string;
  fingerprint: string;
};

export function loadLocalConfig(
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalConfig {
  const path = resolve(
    env.BEANBAG_LOCAL_ENV_FILE ?? join(homedir(), ".config/beanbag/plaid.env"),
  );
  let values: Record<string, string | undefined>;
  try {
    values = parseEnv(readPrivate(project, path));
  } catch (error) {
    if (error instanceof LocalError) throw error;
    throw new LocalError(
      "Save a private local Plaid settings file, then run check-config. See docs/local-integration.md.",
    );
  }
  const required = (name: string): string => {
    const value = values[name]?.trim();
    if (!value || /replace|your_|placeholder|changeme/i.test(value))
      throw new LocalError(
        `Fill in ${name} in the private local settings file; never paste its value into logs or chat.`,
      );
    return value;
  };
  const environment = required("PLAID_ENV");
  if (environment !== "production" && environment !== "sandbox")
    throw new LocalError(
      "Set PLAID_ENV to production or sandbox in the private settings file.",
    );
  const clientId = required("PLAID_CLIENT_ID"),
    secret = required("PLAID_SECRET");
  const checkingMask = required("CHECKING_ACCOUNT_MASK"),
    brokerageMask = required("BROKERAGE_ACCOUNT_MASK");
  if (
    !/^\d{4}$/.test(checkingMask) ||
    !/^\d{4}$/.test(brokerageMask) ||
    checkingMask === brokerageMask
  )
    throw new LocalError(
      "Configure distinct four-digit checking and brokerage account masks privately.",
    );
  const stateDirectory = privateLocation(
    project,
    env.BEANBAG_LOCAL_STATE_DIR ??
      join(homedir(), ".local/share/beanbag", environment),
  );
  const keyFile = privateLocation(
    project,
    env.BEANBAG_LOCAL_KEY_FILE ??
      join(homedir(), ".config/beanbag", `local-${environment}.key`),
  );
  if (
    !outside(stateDirectory, keyFile) ||
    keyFile === path ||
    !outside(stateDirectory, path)
  )
    throw new LocalError(
      "Keep the encryption key and credentials separate from the local data directory.",
    );
  return {
    project,
    environment,
    clientId,
    secret,
    checkingMask,
    brokerageMask,
    stateDirectory,
    keyFile,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify([environment, clientId, checkingMask, brokerageMask]),
      )
      .digest("hex"),
  };
}
