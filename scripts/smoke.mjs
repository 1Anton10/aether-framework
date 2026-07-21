#!/usr/bin/env node
/**
 * Smoke: compile basic example → validate wasm → instantiate.
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
  console.error("smoke: missing compiler — run cargo build -p aether_compiler");
  process.exit(1);
}

const out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });
const entry = path.join(root, "examples/basic/src/App.tsx");
const bindings = path.join(root, "examples/basic/aether.bindings.json");

execFileSync(
  bin,
  ["--file", entry, root, out, bindings],
  {
    env: { ...process.env, AETHER_WASMGC: "1", CARGO_TARGET_DIR: targetDir },
    stdio: "pipe",
  }
);

const wasmPath = path.join(out, "app.wasm");
if (!fs.existsSync(wasmPath)) {
  console.error("smoke: app.wasm not written");
  process.exit(1);
}

const wasm = fs.readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(wasm, {
  env: {
    dom_set_text() {},
    dom_set_attr() {},
    aether_suspend() {},
  },
});
instance.exports.aether_init();
if (typeof instance.exports.inc_count === "function") {
  instance.exports.inc_count();
}
const view = new DataView(instance.exports.memory.buffer);
const count = view.getInt32(8, true);
if (count < 1) {
  console.error("smoke: expected count >= 1 after inc_count, got", count);
  process.exit(1);
}

console.log("smoke OK — wasm instantiate + inc_count →", count);
