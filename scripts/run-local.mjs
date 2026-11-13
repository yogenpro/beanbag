import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle in memory: no credentials, data or generated adapter enters the checkout.
// This entry point is separate from the Worker and never changes Access policy.
try {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const result = await build({
    absWorkingDir: project,
    entryPoints: ["src/local/cli.ts"],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    // Bundled React's Node renderer uses native CommonJS modules such as stream.
    banner: {
      js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(new URL("../package.json", import.meta.url).href)});`,
    },
    write: false,
    logLevel: "silent",
  });
  const module = await import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].contents).toString("base64")
  );
  process.exitCode = await module.main(process.argv.slice(2), project);
} catch {
  process.stderr.write(
    "Unable to start the local tool. Use Node 24+ and install the committed dependencies with npm ci.\n",
  );
  process.exitCode = 1;
}
