#!/usr/bin/env node
/**
 * Smoke: compile each *-counter example → assert wasm + program slots.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, "target");
const bin = process.platform === "win32"
  ? path.join(targetDir, "debug", "aether-compile.exe")
  : path.join(targetDir, "debug", "aether-compile");

if (!fs.existsSync(bin)) {
  console.error("smoke:syntax: missing compiler — run cargo build -p aether_compiler");
  process.exit(1);
}

const examplesDir = path.join(root, "examples");
const counters = fs
  .readdirSync(examplesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.endsWith("-counter"))
  .map((d) => d.name)
  .sort();

if (!counters.length) {
  console.error("smoke:syntax: no *-counter examples found");
  process.exit(1);
}

let failed = 0;
for (const name of counters) {
  const exampleRoot = path.join(examplesDir, name);
  const configPath = path.join(exampleRoot, "aether.config.json");
  if (!fs.existsSync(configPath)) {
    console.error(`smoke:syntax: missing ${name}/aether.config.json`);
    failed++;
    continue;
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const entry = path.join(exampleRoot, config.entry);
  const bindings = path.join(exampleRoot, config.bindings || "aether.bindings.json");
  if (!fs.existsSync(entry)) {
    console.error(`smoke:syntax: missing entry ${config.entry} in ${name}`);
    failed++;
    continue;
  }
  const out = path.join(root, "dist", "smoke-syntax", name);
  fs.mkdirSync(out, { recursive: true });
  try {
    execFileSync(
      bin,
      ["--file", entry, exampleRoot, out, bindings],
      {
        env: { ...process.env, AETHER_WASMGC: "1", CARGO_TARGET_DIR: targetDir },
        stdio: "pipe",
      }
    );
  } catch (e) {
    console.error(`smoke:syntax: compile failed for ${name}`);
    if (e.stderr) console.error(e.stderr.toString());
    if (e.stdout) console.error(e.stdout.toString());
    failed++;
    continue;
  }
  const wasmPath = path.join(out, "app.wasm");
  const programPath = path.join(out, "aether.program.json");
  if (!fs.existsSync(wasmPath)) {
    console.error(`smoke:syntax: ${name} — app.wasm not written`);
    failed++;
    continue;
  }
  if (!fs.existsSync(programPath)) {
    console.error(`smoke:syntax: ${name} — aether.program.json not written`);
    failed++;
    continue;
  }
  const program = JSON.parse(fs.readFileSync(programPath, "utf-8"));
  const slots = program.slots || [];
  if (!Array.isArray(slots) || slots.length === 0) {
    console.error(`smoke:syntax: ${name} — program has no slots`);
    failed++;
    continue;
  }
  const hasItems = slots.some((s) => s.name === "items");
  if (hasItems) {
    const loops = (program.nodes || []).filter(
      (n) => n.control_flow && typeof n.control_flow === "object" && n.control_flow.Loop
    );
    if (!loops.length) {
      console.error(`smoke:syntax: ${name} — items slot but no ControlFlow::Loop`);
      failed++;
      continue;
    }
  }
  console.log(
    `smoke:syntax ok ${name} — slots=${slots.length}${hasItems ? " loop=1" : ""}`
  );
}

if (failed) {
  console.error(`\nsmoke:syntax: ${failed} example(s) failed`);
  process.exit(1);
}
console.log(`\nsmoke:syntax OK — ${counters.length} counter example(s)`);
