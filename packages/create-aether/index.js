#!/usr/bin/env node
/**
 * create-aether — scaffold an Aether app.
 *
 *   npx create-aether my-app
 *   AETHER_HOME=/path/to/aether-framework npx create-aether my-app
 *
 * If the framework is missing, shallow-clones the public repo into ~/.aether/framework.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AETHER_REPO_URL || "https://github.com/1Anton10/aether-framework.git";

function findFramework() {
  if (process.env.AETHER_HOME && fs.existsSync(process.env.AETHER_HOME)) {
    return path.resolve(process.env.AETHER_HOME);
  }
  const mono = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(mono, "crates/aether_compiler"))) return mono;
  let cur = process.cwd();
  while (cur !== path.parse(cur).root) {
    if (fs.existsSync(path.join(cur, "crates/aether_compiler"))) return cur;
    cur = path.dirname(cur);
  }
  const cached = path.join(os.homedir(), ".aether", "framework");
  if (fs.existsSync(path.join(cached, "crates/aether_compiler"))) return cached;
  return null;
}

function ensureFramework() {
  let fw = findFramework();
  if (fw) return fw;

  const dest = path.join(os.homedir(), ".aether", "framework");
  console.log(`
  Framework not found locally.
  Shallow-cloning ${REPO}
  → ${dest}
`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  const clone = spawnSync("git", ["clone", "--depth", "1", REPO, dest], {
    stdio: "inherit",
  });
  if (clone.status !== 0) {
    console.error("git clone failed. Install git or set AETHER_HOME to a local clone.");
    process.exit(1);
  }
  console.log("  Running npm install + setup in framework (first time)…");
  spawnSync("npm", ["install"], { cwd: dest, stdio: "inherit", shell: true });
  spawnSync("npm", ["run", "setup"], { cwd: dest, stdio: "inherit", shell: true });
  return dest;
}

const name = process.argv[2];
if (!name) {
  console.error(`
  create-aether <app-name>

  Example:
    npx create-aether my-app
    cd my-app && npm run dev

  Docs for testers: https://github.com/1Anton10/aether-framework/blob/main/docs/TRY.md
`);
  process.exit(1);
}

const fw = ensureFramework();
process.env.AETHER_HOME = fw;
const cli = path.join(fw, "packages/aether_cli/src/index.ts");
const r = spawnSync(
  process.execPath,
  ["--experimental-strip-types", cli, "create", name],
  { stdio: "inherit", cwd: process.cwd(), env: process.env }
);
process.exit(r.status ?? 1);
