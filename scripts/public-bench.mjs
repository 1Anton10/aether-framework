#!/usr/bin/env node
/**
 * Public bench — dirty DAG + wire encode. Writes site/bench-results.json for the homepage.
 * Run: npm run bench:public
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync(
  process.execPath,
  ["--experimental-strip-types", path.join(root, "packages/aether_bench/bench.ts")],
  { encoding: "utf8", cwd: root }
);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status ?? 1);
}

const data = JSON.parse(r.stdout);
const out = {
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  ...data,
  note: "Independent machine numbers — re-run with npm run bench:public",
};

const dest = path.join(root, "site", "bench-results.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
console.log(`\n[bench:public] wrote ${path.relative(root, dest)}`);
