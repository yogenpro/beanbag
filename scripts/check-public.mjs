import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const ignored = new Set([
  "node_modules",
  ".git",
  ".wrangler",
  "dist",
  ".worker-build",
  "test-results",
  "playwright-report",
  "coverage",
]);
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Publication scan refuses symlinks");
    if (entry.isDirectory()) walk(path);
    else files.push(relative(root, path));
  }
}
let tracked = false;
try {
  if (
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() === root
  ) {
    files.push(
      ...execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean),
    );
    tracked = files.length > 0;
  }
} catch {
  /* First milestone can be checked before Git exists. */
}
if (!tracked) walk(root);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  /\baccess-(?:sandbox|development|production)-[a-z0-9-]{20,}\b/i,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /(?:PLAID_(?:SANDBOX_)?(?:SECRET|CLIENT_ID)|TOKEN_ENCRYPTION_KEY)["']?\s*[:=]\s*["']?[A-Za-z0-9+\/=]{24,}(?=["'\s,;}]|$)/,
  /(?:account(?:_id|_number)?|routing_number)\s*[:=]\s*["']\d{9,19}["']/i,
];
const failures = [];
const extraTerms = process.env.BEANBAG_PRIVACY_TERMS_FILE
  ? readFileSync(process.env.BEANBAG_PRIVACY_TERMS_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
  : [];
for (const file of [...new Set(files)]) {
  if (
    /^(?:private|exports|backups|data)\//.test(file) ||
    /(?:\.sqlite|\.db|\.pem|\.key|\.age|\.log)$/.test(file) ||
    /(?:^|\/)(?:\.env|\.dev.vars)(?!.*\.example$)/.test(file) ||
    /handoff/i.test(file)
  ) {
    failures.push(file + ": private file type");
    continue;
  }
  if (statSync(file).size > 1_000_000) {
    failures.push(file + ": unexpected large file");
    continue;
  }
  const content = readFileSync(file, "utf8");
  if (patterns.some((pattern) => pattern.test(content)))
    failures.push(file + ": credential or account-number pattern");
  // Optional local denylist never becomes part of the repository. Do not echo matched values.
  if (
    file !== "package-lock.json" &&
    extraTerms.some((term) => content.includes(term))
  )
    failures.push(file + ": private denylist match");
}
if (failures.length) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(
  `Public-source scan passed (${new Set(files).size} files). Review the staged diff before the first push.\n`,
);
