/**
 * Fail the CI/local gate if public packages are not npm-packable.
 * Does not publish — only `npm pack --dry-run`.
 * `dir` is packages/<dir>; `name` is the npm package name (workspace id).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packages = [
  { dir: "aether", name: "aether-std" },
  { dir: "aether_runtime", name: "aether_runtime" },
  { dir: "aether_ssr", name: "aether_ssr" },
  { dir: "aether_cli", name: "aether_cli" },
  { dir: "create-aether", name: "create-aether" },
  { dir: "vite-plugin-aether", name: "vite-plugin-aether" },
  { dir: "aether-adapter", name: "aether-adapter" },
  { dir: "aether-compat-react", name: "aether-compat-react" },
  { dir: "aether-compat-vue", name: "aether-compat-vue" },
  { dir: "aether-compat-svelte", name: "aether-compat-svelte" },
  { dir: "aether-compat-solid", name: "aether-compat-solid" },
  { dir: "aether-compat-qwik", name: "aether-compat-qwik" },
  { dir: "aether-compat-lit", name: "aether-compat-lit" },
  { dir: "aether-compat-angular", name: "aether-compat-angular" },
];

let failed = 0;
for (const { dir, name } of packages) {
  const cwd = path.join(root, "packages", dir);
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd,
    encoding: "utf8",
    shell: true,
  });
  if (r.status !== 0) {
    failed++;
    console.error(`[publish:check] FAIL ${name} (${dir})`);
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
