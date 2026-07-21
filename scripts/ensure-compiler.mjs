#!/usr/bin/env node
/**
 * Ensure aether-compile is available: local cargo build, ~/.aether/bin, or GitHub Release.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homeBin = path.join(os.homedir(), ".aether", "bin");
const isWin = process.platform === "win32";
const binName = isWin ? "aether-compile.exe" : "aether-compile";

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function candidates() {
  const out = [];
  if (process.env.AETHER_COMPILE) out.push(process.env.AETHER_COMPILE);
  out.push(path.join(homeBin, binName));
  out.push(path.join(root, "bin", binName));
  const td = process.env.CARGO_TARGET_DIR || path.join(root, "target");
  out.push(path.join(td, "release", binName));
  out.push(path.join(td, "debug", binName));
  return out;
}

function findLocal() {
  for (const c of candidates()) {
    if (c && exists(c)) return c;
  }
  return null;
}

function platformAsset() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `aether-compile-windows-${arch}.exe`;
  if (process.platform === "darwin") return `aether-compile-macos-${arch}`;
  return `aether-compile-linux-${arch}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { "User-Agent": "aether-ensure-compiler" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", reject);
  });
}

async function tryDownloadRelease() {
  const repo = process.env.AETHER_REPO || "1Anton10/aether-framework";
  const tag = process.env.AETHER_RELEASE || "latest";
  const asset = platformAsset();
  const api =
    tag === "latest"
      ? `https://api.github.com/repos/${repo}/releases/latest`
      : `https://api.github.com/repos/${repo}/releases/tags/${tag}`;

  let meta;
  try {
    meta = await new Promise((resolve, reject) => {
      https
        .get(api, { headers: { "User-Agent": "aether-ensure-compiler", Accept: "application/vnd.github+json" } }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });
  } catch {
    return null;
  }

  const assets = meta.assets || [];
  const hit = assets.find((a) => a.name === asset || a.name === binName);
  if (!hit?.browser_download_url) return null;

  fs.mkdirSync(homeBin, { recursive: true });
  const dest = path.join(homeBin, binName);
  console.log(`[ensure-compiler] downloading ${hit.name}…`);
  await download(hit.browser_download_url, dest);
  if (!isWin) fs.chmodSync(dest, 0o755);
  return dest;
}

function cargoBuild() {
  console.log("[ensure-compiler] cargo build -p aether_compiler --release");
  const r = spawnSync(
    "cargo",
    ["build", "-p", "aether_compiler", "--release"],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(root, "target") },
    }
  );
  if (r.status !== 0) return null;
  const p = path.join(
    process.env.CARGO_TARGET_DIR || path.join(root, "target"),
    "release",
    binName
  );
  return exists(p) ? p : null;
}

const found = findLocal();
if (found) {
  console.log(`[ensure-compiler] ok ${found}`);
  process.exit(0);
}

let got = null;
try {
  got = await tryDownloadRelease();
} catch (e) {
  console.warn("[ensure-compiler] release download skipped:", e.message || e);
}
if (!got) got = cargoBuild();

if (!got) {
  console.error(`
[ensure-compiler] FAILED

Install Rust (https://rustup.rs) then:
  cargo build -p aether_compiler --release

Or set AETHER_COMPILE=/path/to/aether-compile
`);
  process.exit(1);
}

console.log(`[ensure-compiler] ok ${got}`);
