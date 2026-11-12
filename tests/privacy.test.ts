import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function scan(contents: string, name = "settings.txt") {
  const directory = mkdtempSync(join(tmpdir(), "beanbag-public-scan-"));
  try {
    writeFileSync(join(directory, name), contents);
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, "../scripts/check-public.mjs")],
      {
        cwd: directory,
        encoding: "utf8",
        env: { PATH: process.env.PATH },
      },
    );
    if (result.error)
      throw new Error("Unable to launch the publication-guard subprocess test");
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("public-source credential guard", () => {
  it("accepts placeholders and synthetic account fixtures", () => {
    expect(
      scan(
        "PLAID_CLIENT_ID=replace_locally\nPLAID_SECRET=replace_locally\n",
        ".env.example",
      ).status,
    ).toBe(0);
    expect(scan('account_id: "test-checking", amount: 400000').status).toBe(0);
  });
  it.each([
    "PLAID_SECRET",
    "PLAID_SANDBOX_SECRET",
    "PLAID_CLIENT_ID",
    "PLAID_SANDBOX_CLIENT_ID",
  ])("rejects quoted and unquoted %s without printing its value", (name) => {
    const value = "b".repeat(32);
    for (const contents of [
      `${name}=${value}\n`,
      `${name}: '${value}'`,
      JSON.stringify({ [name]: value }),
    ]) {
      const result = scan(contents);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(value);
    }
  });
  it("rejects private environment files and Sandbox access tokens", () => {
    expect(scan("placeholder", ".env.sandbox").status).toBe(1);
    const token = ["access", "sandbox", crypto.randomUUID()].join("-");
    expect(scan(token).status).toBe(1);
  });
});
