#!/usr/bin/env node
/** aether doctor — environment check for testers */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const binName = isWin ? "aether-compile.exe" : "aether-compile";

const checks = [];

function ok(name, detail) {
  checks.push({ name, ok: true, detail });
  console.log(`  ✓ ${name} — ${detail}`);
}
function bad(name, detail) {
  checks.push({ name, ok: false, detail });
  console.log(`  ✗ ${name} — ${detail}`);
}

console.log("Aether doctor\n");

const major = Number(process.versions.node.split(".")[0]);
if (major >= 18) ok("node", process.version);
else bad("node", `${process.version} (need >= 18)`);

const cargo = spawnSync("cargo", ["--version"], { encoding: "utf8" });
if (cargo.status === 0) ok("cargo", cargo.stdout.trim());
else bad("cargo", "not found (optional if release binary present)");

const candidates = [
  process.env.AETHER_COMPILE,
  path.join(os.homedir(), ".aether", "bin", binName),
  path.join(root, "bin", binName),
  path.join(root, "target", "release", binName),
  path.join(root, "target", "debug", binName),
].filter(Boolean);

const found = candidates.find((p) => fs.existsSync(p));
if (found) ok("aether-compile", found);
else bad("aether-compile", "missing — run npm run ensure:compiler");

const runtime = path.join(root, "packages/aether_runtime/dist/index.global.js");
if (fs.existsSync(runtime)) ok("runtime.js", runtime);
else bad("runtime.js", "missing — npm run build -w aether_runtime");

const ready = path.join(root, ".aether-ready");
if (fs.existsSync(ready)) ok(".aether-ready", "setup completed");
else bad(".aether-ready", "run npm run setup");

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} issue(s)` : "\nAll checks passed — ready to test.");
process.exit(failed.some((c) => c.name === "node" || c.name === "aether-compile" || c.name === "runtime.js") ? 1 : 0);
