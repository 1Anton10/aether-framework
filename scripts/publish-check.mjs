/**
 * Fail the CI/local gate if public packages are not npm-packable.
 * Does not publish — only `npm pack --dry-run`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packages = [
  "aether",
  "aether_runtime",
  "aether_ssr",
  "aether_cli",
  "create-aether",
  "vite-plugin-aether",
  "aether-adapter",
  "aether-compat-react",
  "aether-compat-vue",
  "aether-compat-svelte",
  "aether-compat-solid",
  "aether-compat-qwik",
  "aether-compat-lit",
  "aether-compat-angular",
];

let failed = 0;
for (const name of packages) {
  const cwd = path.join(root, "packages", name);
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd,
    encoding: "utf8",
    shell: true,
  });
  if (r.status !== 0) {
    failed++;
    console.error(`[publish:check] FAIL ${name}`);
    console.error(r.stderr || r.stdout);
  } else {
    console.log(`[publish:check] ok ${name}`);
  }
}

if (failed) {
  console.error(`\n${failed} package(s) not packable`);
  process.exit(1);
}
console.log("\nAll listed packages pack cleanly (dry-run).");
