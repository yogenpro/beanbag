import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const project = fileURLToPath(new URL("..", import.meta.url));

function credentials() {
  // Dedicated CI names keep inherited live-app settings out of this test path.
  const clientId = process.env.PLAID_SANDBOX_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SANDBOX_SECRET?.trim();
  if (clientId || secret) {
    if (!clientId || !secret)
      throw new Error("Set both Sandbox CI credentials.");
    return { clientId, secret };
  }
  const path = resolve(
    process.env.BEANBAG_SANDBOX_ENV_FILE ??
      join(homedir(), ".config", "beanbag", "plaid-sandbox.env"),
  );
  const location = relative(project, path);
  const outside =
    location === ".." ||
    location.startsWith(".." + sep) ||
    isAbsolute(location);
  if (!outside) {
    throw new Error("Keep the Sandbox credential file outside the repository.");
  }
  let info;
  try {
    info = lstatSync(path);
  } catch {
    throw new Error(
      "Save Sandbox credentials in ~/.config/beanbag/plaid-sandbox.env, or set the two Sandbox CI secrets.",
    );
  }
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Use a regular private credential file.");
  if (
    typeof process.getuid === "function" &&
    ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())
  ) {
    throw new Error(
      "The Sandbox credential file must belong to you with mode 0600.",
    );
  }
  let values;
  try {
    values = parseEnv(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Unable to parse the private Sandbox credential file.");
  }
  if (values.PLAID_ENV !== "sandbox")
    throw new Error(
      "Sandbox tests require PLAID_ENV=sandbox; live configuration is refused.",
    );
  if (!values.PLAID_CLIENT_ID?.trim() || !values.PLAID_SECRET?.trim())
    throw new Error(
      "Fill in PLAID_CLIENT_ID and the Sandbox PLAID_SECRET in the private Sandbox file.",
    );
  return {
    clientId: values.PLAID_CLIENT_ID.trim(),
    secret: values.PLAID_SECRET.trim(),
  };
}

try {
  const keys = credentials();
  if (process.argv.includes("--check-config")) {
    process.stdout.write(
      "Sandbox credential configuration is ready; no network requests were made.\n",
    );
    process.exit(0);
  }
  if (process.argv.length > 2)
    throw new Error("Supported option: --check-config");
  process.stdout.write(
    "Running opt-in Plaid Sandbox integration tests. Production endpoints are disabled.\n",
  );
  const env = {
    ...process.env,
    PLAID_ENV: "sandbox",
    PLAID_CLIENT_ID: "",
    PLAID_SECRET: "",
    PLAID_SANDBOX_CLIENT_ID: keys.clientId,
    PLAID_SANDBOX_SECRET: keys.secret,
    NO_COLOR: "1",
  };
  delete env.FORCE_COLOR;
  const result = spawnSync(
    process.execPath,
    [
      join(project, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--config",
      "vitest.sandbox.config.ts",
    ],
    {
      cwd: project,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const redact = (text) =>
    (text ?? "")
      .replaceAll(keys.clientId, "[redacted client ID]")
      .replaceAll(keys.secret, "[redacted secret]")
      .replace(
        /\b(?:access|public|link)-(?:sandbox|production|development)-[a-z0-9-]+/gi,
        "[redacted Plaid token]",
      );
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
  if (result.error || result.signal) {
    process.stderr.write(
      "Sandbox runner did not finish; no provider payload was printed.\n",
    );
    process.exit(1);
  }
  process.exit(result.status ?? 1);
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : "Sandbox configuration failed") +
      "\n",
  );
  process.exit(1);
}
