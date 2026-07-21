#!/usr/bin/env node
/**
 * create-aether — scaffold an Aether app (like create-vite / create-nuxt).
 *
 *   npx create-aether my-app
 *   AETHER_HOME=/path/to/aether-framework npx create-aether my-app
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findFramework() {
  if (process.env.AETHER_HOME && fs.existsSync(process.env.AETHER_HOME)) {
    return path.resolve(process.env.AETHER_HOME);
  }
  // Running from monorepo: packages/create-aether → repo root
  const mono = path.resolve(__dirname, "../..");
  if (fs.existsSync(path.join(mono, "crates/aether_compiler"))) return mono;
  // Walk up from cwd
  let cur = process.cwd();
  while (cur !== path.parse(cur).root) {
    if (fs.existsSync(path.join(cur, "crates/aether_compiler"))) return cur;
    cur = path.dirname(cur);
  }
  return null;
}

const name = process.argv[2];
if (!name) {
  console.error(`
  create-aether <app-name>

  Scaffold a new Aether application.

  Example:
    npx create-aether my-app
    cd my-app && npm run dev
`);
  process.exit(1);
}

const fw = findFramework();
if (!fw) {
  console.error(`
  Could not find Aether framework.

  Clone the repo, then either:
    cd aether-framework && npm run create -- ${name}
  or:
    set AETHER_HOME=/path/to/aether-framework
    npx create-aether ${name}
`);
  process.exit(1);
}

const cli = path.join(fw, "packages/aether_cli/src/index.ts");
const r = spawnSync(
  process.execPath,
  ["--experimental-strip-types", cli, "create", name],
  { stdio: "inherit", cwd: process.cwd(), env: process.env }
);
process.exit(r.status ?? 1);
