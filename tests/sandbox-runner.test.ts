import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const client = "synthetic-sandbox-client-for-runner-test";
const secret = "synthetic-sandbox-secret-for-runner-test";
function file(
  contents = `PLAID_CLIENT_ID=${client}\nPLAID_SECRET=${secret}\nPLAID_ENV=sandbox\n`,
) {
  const directory = mkdtempSync(join(tmpdir(), "beanbag-sandbox-test-"));
  directories.push(directory);
  const path = join(directory, "sandbox.env");
  writeFileSync(path, contents, { mode: 0o600 });
  return path;
}
function run(path: string, env: Record<string, string> = {}) {
  const result = spawnSync(
    process.execPath,
    ["scripts/run-sandbox-tests.mjs", "--check-config"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { PATH: process.env.PATH, BEANBAG_SANDBOX_ENV_FILE: path, ...env },
    },
  );
  const output = result.stdout + result.stderr;
  if (result.error)
    throw new Error(
      "Unable to launch the credential-isolation subprocess test",
    );
  expect(output.includes(client)).toBe(false);
  expect(output.includes(secret)).toBe(false);
  return { status: result.status, output };
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("opt-in Sandbox credential isolation", () => {
  it("accepts the private Sandbox file without making a network request", () => {
    const result = run(file());
    expect(result.status).toBe(0);
    expect(result.output).toContain("no network requests");
  });
  it("refuses a production environment even if credentials are present", () => {
    const result = run(
      file(
        `PLAID_CLIENT_ID=${client}\nPLAID_SECRET=${secret}\nPLAID_ENV=production\n`,
      ),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("live configuration is refused");
  });
  it("refuses an empty private template", () => {
    expect(
      run(file("PLAID_CLIENT_ID=\nPLAID_SECRET=\nPLAID_ENV=sandbox\n")).status,
    ).toBe(1);
  });
  it("does not fall back to inherited production keys", () => {
    const result = run(
      join(tmpdir(), "beanbag-nonexistent-" + crypto.randomUUID()),
      {
        PLAID_CLIENT_ID: client,
        PLAID_SECRET: secret,
        PLAID_ENV: "production",
      },
    );
    expect(result.status).toBe(1);
  });
  it("uses explicitly named CI Sandbox secrets without loading a local file", () => {
    expect(
      run("/does-not-exist", {
        PLAID_SANDBOX_CLIENT_ID: client,
        PLAID_SANDBOX_SECRET: secret,
      }).status,
    ).toBe(0);
  });
  it("refuses partial CI credentials instead of mixing them with the file", () => {
    expect(run(file(), { PLAID_SANDBOX_CLIENT_ID: client }).status).toBe(1);
  });
  it("refuses a world-readable credential file", () => {
    const path = file();
    chmodSync(path, 0o644);
    expect(run(path).status).toBe(process.platform === "win32" ? 0 : 1);
  });
  it("refuses symlinks and repository-local credential paths", () => {
    const path = file(),
      link = join(path, "..", "link.env");
    symlinkSync(path, link);
    expect(run(link).status).toBe(1);
    expect(run(resolve(import.meta.dirname, "../.env.sandbox")).status).toBe(1);
    expect(
      run(resolve(import.meta.dirname, "../..sandbox.env")).output,
    ).toContain("outside the repository");
  });
});
