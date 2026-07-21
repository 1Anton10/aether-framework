#!/usr/bin/env node
/**
 * One-shot setup for testers: compiler + runtime + smoke + public bench.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: true, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(process.execPath, [path.join(root, "scripts/ensure-compiler.mjs")]);
run("npm", ["run", "build", "-w", "aether_runtime"]);
run("npm", ["run", "smoke"]);
run("npm", ["run", "smoke:syntax"]);
run(process.execPath, [path.join(root, "scripts/public-bench.mjs")]);

fs.writeFileSync(
  path.join(root, ".aether-ready"),
  JSON.stringify({ at: new Date().toISOString(), ok: true }, null, 2) + "\n"
);

console.log(`
╔══════════════════════════════════════════╗
║  Aether ready for testers                ║
╠══════════════════════════════════════════╣
║  npm run start          → http://localhost:3000
║  npm run create -- app  → scaffold
║  /demo                  → live contract
║  Live measure           → homepage bench
╚══════════════════════════════════════════╝
`);
