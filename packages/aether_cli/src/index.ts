import { execFile, spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { Duplex } from "stream";
import { buildPagesManifest, discoverPages } from "./pages.ts";
import { renderToString } from "aether_ssr";

type AetherConfig = {
  root?: string;
  entry?: string;
  state?: string;
  bindings?: string;
  componentsDir?: string;
  outDir?: string;
  watch?: string[];
  wasmgc?: boolean;
  pagesDir?: string;
  ssr?: boolean;
  server?: { port?: number; host?: string };
  site?: { landing?: string; publicDir?: string };
  routes?: Record<string, { type: string; file?: string }>;
  effects?: Record<string, { type: string; arg?: number }>;
};

function findConfigDir(start: string): string {
  let current = start;
  while (current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, "aether.config.json"))) return current;
    if (fs.existsSync(path.join(current, "Cargo.toml"))) return current;
    current = path.dirname(current);
  }
  return start;
}

/** Prefer cwd project config; fall back to framework monorepo. */
function resolveConfigDir(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "aether.config.json"))) return cwd;
  return findConfigDir(path.resolve(__dirname, "../.."));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_DIR = resolveConfigDir();
const CONFIG_PATH = path.join(CONFIG_DIR, "aether.config.json");

/** Framework root (compiler + runtime) — app may live elsewhere. */
function resolveFrameworkRoot(): string {
  const fromPkg = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
      if (pkg.aether?.framework) return path.resolve(pkg.aether.framework);
    } catch {
      /* */
    }
    return "";
  })();
  if (fromPkg && fs.existsSync(fromPkg)) return fromPkg;
  // Walk from CLI location to Cargo.toml monorepo
  return findConfigDir(path.resolve(__dirname, "../.."));
}

const FRAMEWORK_ROOT = resolveFrameworkRoot();

function loadConfig(): AetherConfig {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

const config = loadConfig();
const PROJECT_ROOT = path.resolve(CONFIG_DIR, config.root || ".");
const OUT_DIR = path.resolve(PROJECT_ROOT, config.outDir || "dist");
const ENTRY = path.resolve(PROJECT_ROOT, config.entry || "src/App.tsx");
const STATE_PATH = path.resolve(PROJECT_ROOT, config.state || "src/state.ts");
const BINDINGS_PATH = path.resolve(
  PROJECT_ROOT,
  config.bindings || "aether.bindings.json"
);
const COMPONENTS_DIR = config.componentsDir || "src";
const PORT = Number(process.env.PORT || config.server?.port || 3000);
const LANDING = path.resolve(
  PROJECT_ROOT,
  config.site?.landing || "site/index.html"
);
const PUBLIC_DIR = path.resolve(
  PROJECT_ROOT,
  config.site?.publicDir || "site"
);

const args = process.argv.slice(2);
const COMMAND = args[0] || "start";

let program: any = null;
let serverMemory = new Uint8Array(8);
let loaderData: Record<string, unknown> = {};
const liveClients: http.ServerResponse[] = [];
let watchTimer: ReturnType<typeof setTimeout> | null = null;
const dsmSockets = new Set<Duplex>();

function nid(id: any): number {
  return typeof id === "number" ? id : id?.["0"] ?? 0;
}

function encodeDeltas(deltas: Array<[number, number]>): Buffer {
  const buf = Buffer.alloc(deltas.length * 12);
  let o = 0;
  for (const [slot, value] of deltas) {
    buf.writeUInt32LE(slot, o);
    buf.writeUInt32LE(4, o + 4);
    buf.writeInt32LE(value, o + 8);
    o += 12;
  }
  return buf;
}

function decodeDeltas(bytes: Buffer): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i + 8 <= bytes.length) {
    const slot = bytes.readUInt32LE(i);
    const len = bytes.readUInt32LE(i + 4);
    i += 8;
    if (i + len > bytes.length) break;
    out.push([slot, len >= 4 ? bytes.readInt32LE(i) : 0]);
    i += len;
  }
  return out;
}

function decodeEffectRequest(bytes: Buffer) {
  if (bytes.length < 2) return null;
  const n = bytes.readUInt16LE(0);
  if (bytes.length < 2 + n + 8) return null;
  return {
    effect: bytes.subarray(2, 2 + n).toString("utf8"),
    resume: bytes.readUInt32LE(2 + n),
    payload: bytes.readInt32LE(2 + n + 4),
  };
}

function wsAcceptKey(key: string): string {
  return crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

function wsEncodeBinary(payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x82;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsDecodeFrames(buf: Buffer): { messages: Buffer[]; rest: Buffer } {
  const messages: Buffer[] = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const b1 = buf[i + 1];
    const opcode = buf[i] & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = i + 2;
    if (len === 126) {
      if (off + 2 > buf.length) break;
      len = buf.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (off + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(off));
      off += 8;
    }
    const maskOff = masked ? off : -1;
    if (masked) off += 4;
    if (off + len > buf.length) break;
    let payload = buf.subarray(off, off + len);
    if (masked && maskOff >= 0) {
      const mask = buf.subarray(maskOff, maskOff + 4);
      const copy = Buffer.from(payload);
      for (let j = 0; j < copy.length; j++) copy[j] ^= mask[j % 4];
      payload = copy;
    }
    if (opcode === 0x1 || opcode === 0x2) messages.push(Buffer.from(payload));
    i = off + len;
  }
  return { messages, rest: buf.subarray(i) };
}

function loadInitialState(): Record<string, number> {
  const out: Record<string, number> = {};
  if (!fs.existsSync(STATE_PATH)) return out;
  const src = fs.readFileSync(STATE_PATH, "utf-8");
  const m = src.match(/initialState\s*=\s*\{([^}]*)\}/s);
  if (m) {
    for (const part of m[1].split(",")) {
      const kv = part.match(/(\w+)\s*:\s*(-?\d+)/);
      if (kv) out[kv[1]] = Number(kv[2]);
    }
  }
  return out;
}

function initMemory(prog: any, initial: Record<string, number>) {
  const mem = Buffer.alloc(prog.memory_bytes);
  mem.writeUInt32LE(0x52485441, 0);
  mem.writeUInt32LE(prog.slots.length, 4);
  for (const slot of prog.slots) {
    mem.writeInt32LE(initial[slot.name] ?? 0, slot.offset);
  }
  for (const d of prog.derived || []) {
    const target = prog.slots.find((s: any) => nid(s.id) === nid(d.target));
    const src = prog.slots.find((s: any) => nid(s.id) === nid(d.sources?.[0]));
    if (!target || !src) continue;
    const v = mem.readInt32LE(src.offset);
    let out = v;
    if (d.op?.Mul != null) out = v * d.op.Mul;
    else if (d.op?.Add != null) out = v + d.op.Add;
    mem.writeInt32LE(out, target.offset);
  }
  serverMemory = new Uint8Array(mem);
}

function applyDeltas(deltas: Array<[number, number]>) {
  const applied: Array<[number, number]> = [];
  if (!program) return applied;
  const view = Buffer.from(serverMemory.buffer);
  for (const [slotId, value] of deltas) {
    const slot = program.slots.find((s: any) => nid(s.id) === slotId);
    if (!slot) continue;
    view.writeInt32LE(value, slot.offset);
    applied.push([slotId, value]);
  }
  for (const d of program.derived || []) {
    const target = program.slots.find((s: any) => nid(s.id) === nid(d.target));
    const src = program.slots.find((s: any) => nid(s.id) === nid(d.sources?.[0]));
    if (!target || !src) continue;
    const v = view.readInt32LE(src.offset);
    let out = v;
    if (d.op?.Mul != null) out = v * d.op.Mul;
    else if (d.op?.Add != null) out = v + d.op.Add;
    view.writeInt32LE(out, target.offset);
    applied.push([nid(d.target), out]);
  }
  return applied;
}

const SERVER_CATALOG = [
  { id: 1, name: "Aurora Lamp", tag: "light", price: 49 },
  { id: 2, name: "Nova Chair", tag: "home", price: 120 },
  { id: 3, name: "Pulse Speaker", tag: "audio", price: 89 },
  { id: 4, name: "Orbit Desk", tag: "work", price: 240 },
  { id: 5, name: "Quark Mug", tag: "kitchen", price: 18 },
  { id: 6, name: "Flux Bag", tag: "travel", price: 64 },
];

function runEffectHandler(effect: string, payload: number): { value: number; mode: string } {
  const spec = config.effects?.[effect] || config.effects?.[effect.replace(".", "_")];
  if (!spec) return { value: payload, mode: "value" };
  if (spec.type === "rtt") return { value: 0, mode: "rtt" };
  if (spec.type === "catalog") return { value: SERVER_CATALOG.length, mode: "value" };
  if (spec.type === "toggle") return { value: payload ? 0 : 1, mode: "value" };
  if (spec.type === "set" || spec.type === "fixed") return { value: spec.arg ?? 0, mode: "value" };
  if (spec.type === "add") return { value: payload + (spec.arg ?? 0), mode: "value" };
  if (spec.type === "mul") return { value: payload * (spec.arg ?? 1), mode: "value" };
  return { value: payload, mode: "value" };
}

function handleEffect(bytes: Buffer): { deltas: Array<[number, number]>; mode: string } {
  const req = decodeEffectRequest(bytes);
  if (!req || !program) return { deltas: [], mode: "value" };
  const { value, mode } = runEffectHandler(req.effect, req.payload);
  return { deltas: applyDeltas([[req.resume, value]]), mode };
}

function broadcastDsm(buf: Buffer) {
  const frame = wsEncodeBinary(buf);
  for (const sock of dsmSockets) {
    try {
      sock.write(frame);
    } catch {
      dsmSockets.delete(sock);
    }
  }
}

function slotValuesFromMemory(): Record<string, number> {
  const out: Record<string, number> = {};
  if (!program) return out;
  const view = Buffer.from(serverMemory.buffer);
  for (const slot of program.slots || []) {
    out[slot.name] = view.readInt32LE(slot.offset);
  }
  return out;
}

function appHtml(snapshot: Uint8Array): string {
  const b64 = Buffer.from(snapshot).toString("base64");
  const useSsr = config.ssr !== false && program;
  let ssrBody = "";
  if (useSsr) {
    try {
      ssrBody = renderToString(program, slotValuesFromMemory());
    } catch (e: any) {
      console.warn("[Aether SSR]", e?.message || e);
    }
  }
  const rootInner = ssrBody
    ? `<div id="root" data-aether-ssr="1">${ssrBody}</div>`
    : `<div id="root"></div>`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aether Demo</title>
  <meta name="aether-ssr" content="${ssrBody ? "1" : "0"}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <script src="/runtime.js?v=${Date.now()}" defer></script>
  <script src="/tour-viz.js?v=${Date.now()}" defer></script>
  <style>
    :root{--bg:#07090d;--elev:#10151d;--ink:#eef2f7;--muted:#8b95a8;--line:#1c2430;--accent:#5eead4;--accent-ink:#042f2e;--warm:#fbbf24}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Sora",system-ui,sans-serif;color:var(--ink);background:radial-gradient(900px 500px at 100% -10%,#134e4a44,transparent 50%),var(--bg);line-height:1.55;min-height:100vh}
    #root{min-height:100vh}
    .tour{width:min(960px,calc(100% - 2rem));margin:0 auto;padding:1.25rem 0 3.5rem}
    .tour-nav{display:flex;flex-wrap:wrap;align-items:center;gap:.85rem;margin-bottom:2rem}
    .tour-logo{font-family:"JetBrains Mono",monospace;color:var(--ink);text-decoration:none;font-weight:500;font-size:1.05rem}
    .tour-pill{font-size:.72rem;font-weight:600;padding:.2rem .55rem;border-radius:999px;background:#134e4a;color:var(--accent)}
    .tour-nav a{color:var(--muted);text-decoration:none;font-size:.9rem}
    .tour-nav a:hover{color:var(--accent)}
    .tour-intro h1{font-size:clamp(1.45rem,3.2vw,2rem);letter-spacing:-.03em;margin-bottom:.6rem}
    .tour-intro p{color:var(--muted);max-width:42rem;margin-bottom:2rem}
    .tour-steps{list-style:none;display:grid;gap:1.5rem}
    .tour-step{border:1px solid var(--line);border-radius:.75rem;background:var(--elev);overflow:hidden}
    .tour-step-head{display:flex;gap:1rem;padding:1.25rem 1.25rem .5rem}
    .tour-num{flex:0 0 2rem;height:2rem;border-radius:999px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-weight:700}
    .tour-step-head h2{font-size:1.1rem;margin-bottom:.35rem}
    .tour-why{color:var(--muted);font-size:.95rem}
    .tour-demo{display:grid;grid-template-columns:1.15fr .85fr;gap:0;border-top:1px solid var(--line);margin-top:1rem}
    .tour-demo-ui{padding:1.25rem}
    .tour-explain{padding:1.25rem;background:#0c1118;border-left:1px solid var(--line)}
    .tour-explain h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:.5rem}
    .tour-explain p{color:var(--muted);font-size:.9rem;margin-bottom:.75rem}
    .tour-explain code,.tour-why code,.tour-finale code{font-family:"JetBrains Mono",monospace;color:var(--warm);font-size:.85em}
    .tour-label{color:var(--muted);font-size:.85rem;margin-bottom:.35rem}
    .tour-big{font-family:"JetBrains Mono",monospace;font-size:2.4rem;color:var(--accent);letter-spacing:-.04em;margin-bottom:.6rem}
    .tour-btns{display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0}
    button{font:inherit;font-weight:600;font-size:.88rem;cursor:pointer;padding:.55rem .9rem;border-radius:.4rem;border:1px solid var(--line);background:#161c26;color:var(--ink)}
    button:hover{border-color:var(--accent)}
    .tour-hint{color:var(--muted);font-size:.88rem;margin-top:.75rem}
    .viz-log{margin-top:.5rem;padding:.65rem .75rem;border-radius:.4rem;background:#121820;border:1px solid var(--line);color:var(--accent);font-size:.82rem;font-family:"JetBrains Mono",monospace}
    .viz-shelf{display:flex;flex-wrap:wrap;gap:.35rem;min-height:2.2rem;margin-bottom:.5rem}
    .viz-item{width:1.5rem;height:1.5rem;border-radius:.3rem;background:linear-gradient(145deg,#2dd4bf,#0f766e);display:grid;place-items:center;color:#042f2e;font-size:.65rem;animation:pop .25s ease}
    .viz-empty,.viz-empty-inline{color:var(--muted);font-size:.88rem}
    .viz-dag{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem}
    .viz-node{padding:.65rem .8rem;border:1px solid var(--line);border-radius:.5rem;background:#0c1219;min-width:4.5rem;transition:box-shadow .25s,border-color .25s}
    .viz-node span{display:block;font-size:.72rem;color:var(--muted)}
    .viz-node strong{font-family:"JetBrains Mono",monospace;font-size:1.2rem}
    .viz-node.flash{border-color:var(--accent);box-shadow:0 0 0 3px #5eead433}
    .viz-arrow{color:var(--accent);font-weight:700}
    .viz-packets{display:grid;gap:.5rem;margin-top:.85rem}
    .viz-packet{padding:.65rem .8rem;border-radius:.45rem;font-family:"JetBrains Mono",monospace;font-size:.82rem;border:1px solid var(--line)}
    .viz-packet.json{opacity:.55}
    .viz-packet.bin.idle{color:var(--muted)}
    .viz-packet.bin.live{border-color:var(--accent);color:var(--accent);background:#0c1614}
    .viz-timeline{display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem;margin-bottom:.85rem}
    .viz-tl-step{font-size:.72rem;padding:.45rem .35rem;text-align:center;border-radius:.35rem;border:1px solid var(--line);color:var(--muted);background:#0c1219}
    .viz-tl-step.on{border-color:var(--warm);color:var(--warm)}
    .viz-tl-step.done{border-color:var(--accent);color:var(--accent);background:#0c1614}
    .viz-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
    .tour-why-list{list-style:none;display:grid;gap:.4rem;margin:1rem 0 1.25rem;padding:0;color:var(--muted);font-size:.92rem}
    .tour-why-list strong{color:var(--ink)}
    .tour-runtime{font-family:"JetBrains Mono",monospace;font-size:.78rem;color:var(--accent);margin-bottom:1.5rem}
    .viz-ssr{margin:0;padding:.85rem;background:#0c1219;border:1px solid var(--line);border-radius:.45rem;font-family:"JetBrains Mono",monospace;font-size:.82rem;color:var(--warm);white-space:pre-wrap}
    .viz-metric-row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin:1rem 0}
    .viz-metric{padding:.85rem;border:1px solid var(--line);border-radius:.45rem;background:#0c1219}
    .viz-metric span{display:block;font-size:.72rem;color:var(--muted);margin-bottom:.25rem}
    .viz-metric strong{font-family:"JetBrains Mono",monospace;font-size:1.8rem;color:var(--accent)}
    .viz-metric em{font-style:normal;color:var(--muted);margin-left:.25rem;font-size:.9rem}
    .viz-catalog{margin-top:.75rem;min-height:4rem}
    .viz-cat-title{font-size:.85rem;color:var(--muted);margin-bottom:.5rem}
    .viz-cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.5rem}
    .viz-card{padding:.7rem;border:1px solid var(--line);border-radius:.45rem;background:#0c1219;animation:pop .3s ease}
    .viz-card h4{font-size:.88rem;margin-bottom:.25rem}
    .viz-card span{font-size:.72rem;color:var(--accent)}
    .viz-ping{margin-top:1rem;padding:1rem;border:1px solid var(--line);border-radius:.5rem;background:#0c1219;position:relative;overflow:hidden}
    .viz-ping-pulse{position:absolute;inset:auto auto 0 0;width:4rem;height:4rem;border-radius:50%;background:#5eead433;transform:translate(-40%,40%) scale(0);opacity:0}
    .viz-ping.pulse .viz-ping-pulse{animation:ping 1s ease}
    #viz-ping-status{position:relative;font-size:.9rem;color:var(--muted)}
    .viz-list{list-style:none;display:grid;gap:.35rem;margin:.75rem 0}
    .viz-list-item{padding:.5rem .75rem;border:1px solid var(--line);border-radius:.35rem;background:#0c1219;font-family:"JetBrains Mono",monospace;font-size:.85rem;color:var(--accent)}
    .tour-finale{margin-top:2rem;padding:1.5rem;border:1px solid var(--line);border-radius:.75rem;background:linear-gradient(135deg,#10151d,#0c1614)}
    .tour-finale h2{font-size:1.2rem;margin-bottom:.5rem}
    .tour-finale p{color:var(--muted);margin-bottom:.75rem}
    .tour-finale-links{display:flex;flex-wrap:wrap;gap:1rem;align-items:center}
    .tour-cta{display:inline-flex;padding:.65rem 1rem;background:var(--accent);color:var(--accent-ink);text-decoration:none;font-weight:700;border-radius:.4rem}
    .tour-finale-links a:not(.tour-cta){color:var(--muted)}
    @keyframes pop{from{transform:scale(.7);opacity:0}to{transform:none;opacity:1}}
    @keyframes ping{0%{transform:translate(-40%,40%) scale(.2);opacity:.9}100%{transform:translate(-40%,40%) scale(3);opacity:0}}
    @media(max-width:800px){.tour-demo{grid-template-columns:1fr}.tour-explain{border-left:0;border-top:1px solid var(--line)}.viz-timeline{grid-template-columns:1fr 1fr}}
  </style>
</head>
<body>
  ${rootInner}
  <script type="aether/snapshot" data-encoding="base64">${b64}</script>
  <script type="application/json" id="aether-loaders">${JSON.stringify(loaderData)}</script>
</body>
</html>`;
}

function compilerBinary(): string {
  const isWin = process.platform === "win32";
  const binName = isWin ? "aether-compile.exe" : "aether-compile";
  const homeBin = path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    ".aether",
    "bin",
    binName
  );
  const td = process.env.CARGO_TARGET_DIR || path.resolve(FRAMEWORK_ROOT, "target");
  const candidates = [
    process.env.AETHER_COMPILE || "",
    homeBin,
    path.resolve(FRAMEWORK_ROOT, "bin", binName),
    path.join(td, "release", binName),
    path.join(td, "debug", binName),
    path.resolve(CONFIG_DIR, "target/release", binName),
    path.resolve(CONFIG_DIR, "target/debug", binName),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return binName;
}

function runtimePath(): string {
  return path.resolve(FRAMEWORK_ROOT, "packages/aether_runtime/dist/index.global.js");
}

function notifyLiveReload() {
  for (const res of liveClients.splice(0)) {
    try {
      res.write("data: reload\n\n");
      res.end();
    } catch {
      /* */
    }
  }
}

function resolveRoute(urlPath: string): { type: string; file?: string } {
  const clean = urlPath.split("?")[0];
  const routes = config.routes || {
    "/": { type: "static", file: config.site?.landing || "site/index.html" },
    "/demo": { type: "app" },
    "/app": { type: "app" },
  };
  if (routes[urlPath]) return routes[urlPath];
  if (routes[clean]) return routes[clean];

  // File-based pages → app shell (client router / SSR entry)
  const pages = discoverPages(PROJECT_ROOT);
  for (const p of pages) {
    if (p.route === clean) return { type: "app", file: p.file };
    // param routes: /users/:id
    if (p.route.includes(":")) {
      const re = new RegExp(
        "^" + p.route.replace(/:[^/]+/g, "[^/]+") + "$"
      );
      if (re.test(clean)) return { type: "app", file: p.file };
    }
  }

  return { type: "static", file: config.site?.landing || "site/index.html" };
}

function startDevServer() {
  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (url.startsWith("/api/live-reload")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      liveClients.push(res);
      req.on("close", () => {
        const i = liveClients.indexOf(res);
        if (i >= 0) liveClients.splice(i, 1);
      });
      return;
    }

    if (url === "/api/delta" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        let deltas = decodeDeltas(Buffer.concat(chunks));
        const action = req.headers["x-aether-action"] as string | undefined;
        if (deltas.length === 0 && action && program?.effects?.[action]) {
          const effect = program.effects[action];
          const mutate = effect.ServerMutate || effect.LocalMutate;
          if (mutate) {
            const slotId = nid(mutate.slot);
            const slot = program.slots.find((s: any) => nid(s.id) === slotId);
            const delta = mutate.delta ?? 1;
            if (slot) {
              const cur = Buffer.from(serverMemory.buffer).readInt32LE(slot.offset);
              deltas = [[slotId, cur + delta]];
            }
          }
        }
        const applied = applyDeltas(deltas);
        const out = encodeDeltas(applied);
        broadcastDsm(out);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(out);
      });
      return;
    }

    if (url === "/api/catalog" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ items: SERVER_CATALOG, source: "server-memory" }));
      return;
    }

    if (url === "/api/effect" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const { deltas, mode } = handleEffect(Buffer.concat(chunks));
        const out = encodeDeltas(deltas);
        broadcastDsm(out);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "X-Aether-Effect-Mode": mode,
        });
        res.end(out);
      });
      return;
    }

    if (url === "/api/ssr" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Aether-SSR": "stream",
      });
      void (async () => {
        try {
          const { renderToStream } = await import("aether_ssr");
          if (!program) {
            res.end("<!-- no program -->");
            return;
          }
          for await (const chunk of renderToStream(program, slotValuesFromMemory())) {
            res.write(chunk);
          }
          res.end();
        } catch (e: any) {
          res.end(`<!-- ssr error: ${e?.message || e} -->`);
        }
      })();
      return;
    }

    if (url === "/loader-data.json") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(loaderData));
      return;
    }

    if (url.startsWith("/runtime.js")) {
      const p = runtimePath();
      if (fs.existsSync(p)) {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(fs.readFileSync(p));
        return;
      }
    }

    if (url === "/app.wasm" || url === "/app.gc.wasm") {
      const p = path.join(OUT_DIR, path.basename(url));
      if (fs.existsSync(p)) {
        res.writeHead(200, { "Content-Type": "application/wasm" });
        res.end(fs.readFileSync(p));
        return;
      }
    }

    if (url === "/aether.program.json") {
      const p = path.join(OUT_DIR, "aether.program.json");
      if (fs.existsSync(p)) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(fs.readFileSync(p));
        return;
      }
    }

    // static site assets (do not treat /api.html as /api/* endpoints)
    if (
      url !== "/" &&
      !url.startsWith("/api/") &&
      !url.startsWith("/demo") &&
      url !== "/app" &&
      !url.startsWith("/app/")
    ) {
      const filePath = path.join(PUBLIC_DIR, url.replace(/^\//, ""));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".svg": "image/svg+xml",
          ".json": "application/json",
        };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
        res.end(fs.readFileSync(filePath));
        return;
      }
    }

    const route = resolveRoute(url);
    if (route.type === "app") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; font-src https://fonts.gstatic.com; connect-src 'self' ws: wss:",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      res.end(appHtml(serverMemory));
      return;
    }

    const file = path.resolve(PROJECT_ROOT, route.file || LANDING);
    if (fs.existsSync(file)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(file));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.on("upgrade", (req, socket) => {
    const u = req.url || "";
    if (!u.startsWith("/api/dsm") && !u.startsWith("/aether-dsm")) {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key || Array.isArray(key)) {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n\r\n`
    );
    dsmSockets.add(socket);
    let buf: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.from(Buffer.concat([buf, chunk]));
      const { messages, rest } = wsDecodeFrames(buf);
      buf = Buffer.from(rest);
      for (const msg of messages) {
        const out =
          msg[0] === 0xef
            ? encodeDeltas(handleEffect(msg.subarray(1)).deltas)
            : encodeDeltas(applyDeltas(decodeDeltas(msg)));
        socket.write(wsEncodeBinary(out));
        broadcastDsm(out);
      }
    });
    socket.on("close", () => dsmSockets.delete(socket));
    socket.on("error", () => dsmSockets.delete(socket));
  });

  const watchPaths = (config.watch || [path.dirname(ENTRY)]).map((p) =>
    path.resolve(PROJECT_ROOT, p)
  );
  for (const w of watchPaths) {
    if (!fs.existsSync(w)) continue;
    fs.watch(w, { recursive: true }, (_e, filename) => {
      if (!filename) return;
      if (watchTimer) clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        console.log(`[Aether HMR] ${filename}`);
        runCompilation(() => notifyLiveReload(), false);
      }, 120);
    });
  }

  server.listen(PORT, () => {
    console.log(`Aether http://localhost:${PORT}  (landing / · tour /demo · api /api.html)`);
    console.log(`  entry=${path.relative(PROJECT_ROOT, ENTRY)}`);
    console.log(`  outDir=${OUT_DIR}`);
    console.log(`  DSM: WS /aether-dsm · /api/dsm · HTTP /api/delta · SSR stream /api/ssr`);
    if (process.env.AETHER_TLS_CERT && process.env.AETHER_TLS_KEY) {
      void startHttp3WebTransport();
    }
  });
}

/** Optional HTTP/3 WebTransport server when TLS certs are provided. */
async function startHttp3WebTransport() {
  const cert = process.env.AETHER_TLS_CERT!;
  const key = process.env.AETHER_TLS_KEY!;
  const wtPort = Number(process.env.AETHER_WT_PORT || 4433);
  try {
    // Dynamic import — optional peer dep for real HTTP/3.
    const mod: any = await import("@fails-components/webtransport").catch(() => null);
    if (!mod?.Http3Server) {
      console.log(
        "[Aether WT] set AETHER_TLS_* and install @fails-components/webtransport for native HTTP/3"
      );
      return;
    }
    const server = new mod.Http3Server({
      port: wtPort,
      host: "0.0.0.0",
      secret: "aether-dsm",
      cert,
      privKey: key,
    });
    server.startServer();
    console.log(`[Aether WT] HTTP/3 WebTransport on :${wtPort}/aether-dsm`);
    void (async () => {
      const sessionStream = await server.sessionStream("/aether-dsm");
      const reader = sessionStream.getReader();
      while (true) {
        const { value: session, done } = await reader.read();
        if (done) break;
        try {
          await session.ready;
          const dgReader = session.datagrams.readable.getReader();
          const dgWriter = session.datagrams.writable.getWriter();
          while (true) {
            const { value, done: d2 } = await dgReader.read();
            if (d2) break;
            if (!value) continue;
            const msg = Buffer.from(value);
            const out =
              msg[0] === 0xef
                ? encodeDeltas(handleEffect(msg.subarray(1)).deltas)
                : encodeDeltas(applyDeltas(decodeDeltas(msg)));
            await dgWriter.write(out);
            broadcastDsm(out);
          }
        } catch {
          /* session ended */
        }
      }
    })();
  } catch (e: any) {
    console.warn("[Aether WT] HTTP/3 unavailable:", e?.message || e);
  }
}

async function refreshLoaders() {
  loaderData = {};
  try {
    const manifest = buildPagesManifest(PROJECT_ROOT);
    for (const page of manifest) {
      if (!page.loader) continue;
      const abs = path.join(PROJECT_ROOT, page.loader);
      try {
        const mod: any = await import(pathToFileURL(abs).href + `?t=${Date.now()}`);
        const fn = mod.load || mod.default;
        if (typeof fn === "function") {
          loaderData[page.route] = await fn();
        }
      } catch (e: any) {
        loaderData[page.route] = { error: String(e?.message || e) };
      }
    }
    fs.writeFileSync(
      path.join(OUT_DIR, "loader-data.json"),
      JSON.stringify(loaderData, null, 2)
    );
  } catch (e: any) {
    console.warn("[Aether loaders]", e?.message || e);
  }
}

function runCompilation(callback?: () => void, exitOnError = true) {
  if (!fs.existsSync(ENTRY)) {
    console.error("entry not found:", ENTRY);
    if (exitOnError) process.exit(1);
    return;
  }
  const bin = compilerBinary();
  if (!fs.existsSync(bin)) {
    console.error("compiler missing — cargo build -p aether_compiler");
    if (exitOnError) process.exit(1);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bindingsArg = fs.existsSync(BINDINGS_PATH) ? BINDINGS_PATH : "";
  // Prefer --file so shells never mangle JSX `<...>`
  const compileArgs = ["--file", ENTRY, PROJECT_ROOT, OUT_DIR];
  if (bindingsArg) compileArgs.push(bindingsArg);

  const env = {
    ...process.env,
    AETHER_PROJECT_ROOT: PROJECT_ROOT,
    AETHER_COMPONENTS_DIR: COMPONENTS_DIR,
    CARGO_TARGET_DIR:
      process.env.CARGO_TARGET_DIR || path.join(FRAMEWORK_ROOT, "target"),
  };
  if (bindingsArg) (env as any).AETHER_BINDINGS = bindingsArg;
  if (config.wasmgc) (env as any).AETHER_WASMGC = "1";

  execFile(bin, compileArgs, { encoding: "buffer", maxBuffer: 20 << 20, env }, (error, stdout, stderr) => {
    if (error) {
      console.error("compile failed", error.message);
      if (stderr?.length) console.error(stderr.toString("utf-8"));
      if (exitOnError) process.exit(1);
      return;
    }
    program = JSON.parse(stdout.toString("utf-8").trim());
    initMemory(program, loadInitialState());
    // File-based pages manifest + loaders
    void refreshLoaders().then(() => {
      try {
        const manifest = buildPagesManifest(PROJECT_ROOT);
        fs.writeFileSync(
          path.join(OUT_DIR, "pages.manifest.json"),
          JSON.stringify(manifest, null, 2)
        );
        if (manifest.length) {
          console.log(
            `[Aether] pages=${manifest.map((m) => m.route).join(", ") || "—"}`
          );
        }
      } catch (e: any) {
        console.warn("[Aether pages]", e?.message || e);
      }
      console.log(
        `[Aether] slots=${program.slots.length} derived=${(program.derived || []).length} handlers=${Object.keys(program.effects || {}).join(",") || "—"} ssr=${config.ssr !== false}`
      );
      callback?.();
    });
  });
}

function writeProductionBundle() {
  const dist = path.resolve(PROJECT_ROOT, "dist_production");
  fs.mkdirSync(dist, { recursive: true });
  for (const f of ["app.wasm", "app.gc.wasm", "aether.program.json"]) {
    const src = path.join(OUT_DIR, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, f));
  }
  const rt = runtimePath();
  if (fs.existsSync(rt)) fs.copyFileSync(rt, path.join(dist, "runtime.js"));
  if (fs.existsSync(LANDING)) fs.copyFileSync(LANDING, path.join(dist, "index.html"));
  fs.writeFileSync(path.join(dist, "demo.html"), appHtml(serverMemory));
  console.log(`[Aether] build → ${dist}`);
}

function handleMigrateCommand() {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.error("migrate: package.json not found in cwd");
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const detected = detectFramework(deps, cwd);
  pkg.dependencies = pkg.dependencies || {};

  // Alias common UI libs → Aether compat shims when present
  const aliasMap: Record<string, string> = {
    react: "aether-compat-react",
    "react-dom": "aether-compat-react",
    preact: "aether-compat-react",
    "preact/hooks": "aether-compat-react",
    vue: "aether-compat-vue",
    "vue-router": "aether-compat-vue",
    pinia: "aether-compat-vue",
    "weex-vue-framework": "aether-compat-vue",
    svelte: "aether-compat-svelte",
    solidjs: "aether-compat-solid",
    "solid-js": "aether-compat-solid",
    "@builder.io/qwik": "aether-compat-qwik",
    lit: "aether-compat-lit",
    "lit-html": "aether-compat-lit",
    "@angular/core": "aether-compat-angular",
    "@analogjs/platform": "aether-compat-angular",
    alpinejs: "aether-compat-vue",
  };
  for (const [from, to] of Object.entries(aliasMap)) {
    if (deps[from] || pkg.dependencies[from]) {
      delete pkg.dependencies[from];
      pkg.dependencies[to] = "*";
      pkg.overrides = pkg.overrides || {};
      pkg.overrides[from] = to;
    }
  }

  const entry = detected.entry;
  const pagesMapped = mapFrameworkPagesToAether(cwd, detected.name);
  const config = {
    root: ".",
    entry: pagesMapped.entry || entry,
    state: "src/state.ts",
    bindings: "aether.bindings.json",
    componentsDir: "src",
    pagesDir: "src/pages",
    ssr: true,
    outDir: "dist",
    watch: ["src"],
    wasmgc: true,
    server: { port: 3000 },
    site: { landing: "index.html", publicDir: "public" },
    routes: {
      "/": { type: "app" },
    },
    effects: {},
    migratedFrom: detected.name,
    frontend: detected.name,
  };
  fs.writeFileSync(path.join(cwd, "aether.config.json"), JSON.stringify(config, null, 2));
  if (!fs.existsSync(path.join(cwd, "aether.bindings.json"))) {
    fs.writeFileSync(
      path.join(cwd, "aether.bindings.json"),
      JSON.stringify({ derived: [], handlers: {} }, null, 2)
    );
  }
  if (!fs.existsSync(path.join(cwd, "src/state.ts"))) {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src/state.ts"), "export const initialState = {};\n");
  }

  // Rewrite imports for aliased packages
  const rewrites: Array<[RegExp, string]> = [
    [/from ["']react["']/g, 'from "aether-compat-react"'],
    [/from ["']react-dom\/client["']/g, 'from "aether-compat-react/client"'],
    [/from ["']react-dom["']/g, 'from "aether-compat-react/client"'],
    [/from ["']react\/jsx-runtime["']/g, 'from "aether-compat-react/jsx-runtime"'],
    [/from ["']preact["']/g, 'from "aether-compat-react"'],
    [/from ["']preact\/hooks["']/g, 'from "aether-compat-react"'],
    [/from ["']vue["']/g, 'from "aether-compat-vue"'],
    [/from ["']pinia["']/g, 'from "aether-compat-vue"'],
    [/from ["']svelte["']/g, 'from "aether-compat-svelte"'],
    [/from ["']svelte\/store["']/g, 'from "aether-compat-svelte"'],
    [/from ["']solid-js["']/g, 'from "aether-compat-solid"'],
    [/from ["']@builder\.io\/qwik["']/g, 'from "aether-compat-qwik"'],
    [/from ["']lit["']/g, 'from "aether-compat-lit"'],
    [/from ["']lit-html["']/g, 'from "aether-compat-lit"'],
    [/from ["']@angular\/core["']/g, 'from "aether-compat-angular"'],
    [/from ["']alpinejs["']/g, 'from "aether-compat-vue"'],
    [/from ["']@remix-run\/react["']/g, 'from "aether-compat-react"'],
    [/from ["']gatsby["']/g, 'from "aether-compat-react"'],
  ];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === "dist") continue;
        walk(p);
      } else if (/\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/.test(name)) {
        let src = fs.readFileSync(p, "utf-8");
        let next = src;
        for (const [re, to] of rewrites) next = next.replace(re, to);
        if (next !== src) fs.writeFileSync(p, next);
      }
    }
  };
  walk(cwd);

  pkg.scripts = pkg.scripts || {};
  pkg.scripts["dev:aether"] = "npm run start -w aether_cli";
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log(`[Aether migrate] wrote aether.config.json (from ${detected.name})`);
  console.log(`[Aether migrate] entry=${config.entry}; compat aliases applied`);
  if (pagesMapped.copied) {
    console.log(`[Aether migrate] copied ${pagesMapped.copied} page files → src/pages`);
  }
  console.log(`[Aether migrate] next: adapt data fetching to loaders + bindings, then npm run dev`);
  process.exit(0);
}

/** Copy Next app/pages or Nuxt pages into src/pages for file-based Aether routes. */
function mapFrameworkPagesToAether(
  cwd: string,
  name: string
): { entry: string; copied: number } {
  const dest = path.join(cwd, "src/pages");
  let copied = 0;
  const copyTree = (from: string) => {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(dest, { recursive: true });
    const walk = (dir: string, rel = "") => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith(".") || ent.name === "api") continue;
        const src = path.join(dir, ent.name);
        const relPath = path.join(rel, ent.name);
        if (ent.isDirectory()) {
          walk(src, relPath);
          continue;
        }
        if (!/\.(tsx|jsx|vue|svelte|js|ts)$/.test(ent.name)) continue;
        // Next: page.tsx → index.tsx in folder; pages/index → index
        let outRel = relPath.replace(/\\/g, "/");
        outRel = outRel
          .replace(/\/page\.(tsx|jsx|js|ts)$/i, "/index.$1")
          .replace(/^page\.(tsx|jsx|js|ts)$/i, "index.$1")
          .replace(/\/\+page\.(svelte|tsx|jsx|js|ts|vue)$/i, "/index.$1")
          .replace(/^\+page\.(svelte|tsx|jsx|js|ts|vue)$/i, "index.$1");
        const out = path.join(dest, outRel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        if (!fs.existsSync(out)) {
          fs.copyFileSync(src, out);
          copied++;
        }
      }
    };
    walk(from);
  };

  if (name === "next" || name === "remix" || name === "gatsby") {
    if (fs.existsSync(path.join(cwd, "app"))) copyTree(path.join(cwd, "app"));
    else if (fs.existsSync(path.join(cwd, "pages"))) copyTree(path.join(cwd, "pages"));
    else if (fs.existsSync(path.join(cwd, "src/pages"))) copyTree(path.join(cwd, "src/pages"));
  } else if (name === "nuxt" || name === "vue" || name === "weex") {
    if (fs.existsSync(path.join(cwd, "pages"))) copyTree(path.join(cwd, "pages"));
    else if (fs.existsSync(path.join(cwd, "app/pages"))) copyTree(path.join(cwd, "app/pages"));
  } else if (name === "svelte" || name === "sveltekit" || name === "elder") {
    if (fs.existsSync(path.join(cwd, "src/routes"))) copyTree(path.join(cwd, "src/routes"));
    else if (fs.existsSync(path.join(cwd, "routes"))) copyTree(path.join(cwd, "routes"));
  } else if (name === "astro") {
    if (fs.existsSync(path.join(cwd, "src/pages"))) copyTree(path.join(cwd, "src/pages"));
  } else if (name === "analog" || name === "angular") {
    if (fs.existsSync(path.join(cwd, "src/app"))) copyTree(path.join(cwd, "src/app"));
  }

  const entry =
    copied > 0 && fs.existsSync(path.join(dest, "index.tsx"))
      ? "src/pages/index.tsx"
      : copied > 0 && fs.existsSync(path.join(dest, "index.vue"))
        ? "src/pages/index.vue"
        : copied > 0 && fs.existsSync(path.join(dest, "index.svelte"))
          ? "src/pages/index.svelte"
          : "";
  return { entry, copied };
}

function detectFramework(
  deps: Record<string, string>,
  cwd: string
): { name: string; entry: string } {
  const exists = (...parts: string[]) => fs.existsSync(path.join(cwd, ...parts));

  // Meta / specialized first (more specific deps)
  if (deps["@analogjs/platform"] || deps["@analogjs/vite-plugin-angular"]) {
    return {
      name: "analog",
      entry: exists("src/app/app.component.html")
        ? "src/app/app.component.html"
        : "src/app/pages/index.page.ts",
    };
  }
  if (deps["@elderjs/elderjs"] || deps["@elderjs/svelte"]) {
    return {
      name: "elder",
      entry: exists("src/routes/home/Home.svelte")
        ? "src/routes/home/Home.svelte"
        : "src/App.svelte",
    };
  }
  if (deps.astro) {
    return {
      name: "astro",
      entry: exists("src/pages/index.astro") ? "src/pages/index.astro" : "src/pages/index.tsx",
    };
  }
  if (deps["@remix-run/react"] || deps["@remix-run/node"] || deps["@remix-run/cloudflare"]) {
    return {
      name: "remix",
      entry: exists("app/routes/_index.tsx") ? "app/routes/_index.tsx" : "app/root.tsx",
    };
  }
  if (deps.gatsby) {
    return {
      name: "gatsby",
      entry: exists("src/pages/index.tsx") ? "src/pages/index.tsx" : "src/pages/index.js",
    };
  }
  if (deps.next) {
    return {
      name: "next",
      entry: exists("app/page.tsx") ? "app/page.tsx" : "pages/index.tsx",
    };
  }
  if (deps.nuxt || deps["@nuxt/kit"]) {
    return { name: "nuxt", entry: exists("app.vue") ? "app.vue" : "src/App.vue" };
  }
  if (deps["@sveltejs/kit"]) {
    return {
      name: "sveltekit",
      entry: exists("src/routes/+page.svelte") ? "src/routes/+page.svelte" : "src/App.svelte",
    };
  }
  if (deps["@angular/core"] || deps.angular) {
    return {
      name: "angular",
      entry: exists("src/app/app.component.html")
        ? "src/app/app.component.html"
        : "src/app/app.component.ts",
    };
  }
  if (deps["solid-js"] || deps.solidjs) {
    return { name: "solid", entry: exists("src/App.tsx") ? "src/App.tsx" : "src/App.jsx" };
  }
  if (deps["@builder.io/qwik"]) {
    return { name: "qwik", entry: exists("src/routes/index.tsx") ? "src/routes/index.tsx" : "src/app.tsx" };
  }
  if (deps.lit || deps["lit-element"] || deps["lit-html"]) {
    return { name: "lit", entry: exists("src/my-element.ts") ? "src/my-element.ts" : "src/App.ts" };
  }
  if (deps["weex-vue-framework"] || deps.weex) {
    return { name: "weex", entry: exists("src/App.vue") ? "src/App.vue" : "app.vue" };
  }
  if (deps.alpinejs || deps.Alpine) {
    return {
      name: "alpine",
      entry: exists("index.html") ? "index.html" : "src/index.html",
    };
  }
  if (deps.svelte) {
    return { name: "svelte", entry: exists("src/App.svelte") ? "src/App.svelte" : "src/routes/+page.svelte" };
  }
  if (deps.vue || deps.pinia) {
    return { name: "vue", entry: exists("app.vue") ? "app.vue" : "src/App.vue" };
  }
  if (deps.preact) {
    return { name: "preact", entry: exists("src/app.tsx") ? "src/app.tsx" : "src/App.tsx" };
  }
  if (deps.react || deps["react-dom"]) {
    return { name: "react", entry: "src/App.tsx" };
  }
  if (deps.vite) {
    return { name: "vite", entry: "src/App.tsx" };
  }
  const candidates = [
    "src/App.tsx",
    "src/App.jsx",
    "src/App.vue",
    "src/App.svelte",
    "app.vue",
    "index.html",
  ];
  for (const c of candidates) {
    if (exists(c)) return { name: "generic", entry: c };
  }
  return { name: "unknown", entry: "src/App.tsx" };
}

function handleCreateCommand() {
  const name = args[1];
  if (!name || name.startsWith("-")) {
    console.error("Usage: aether create <app-name>");
    process.exit(1);
  }
  const target = path.isAbsolute(name) ? name : path.resolve(process.cwd(), name);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    console.error("create: directory not empty:", target);
    process.exit(1);
  }
  fs.mkdirSync(path.join(target, "src"), { recursive: true });
  fs.mkdirSync(path.join(target, "public"), { recursive: true });

  const frameworkRoot = FRAMEWORK_ROOT;
  const cliEntry = path
    .relative(target, path.join(frameworkRoot, "packages/aether_cli/src/index.ts"))
    .replace(/\\/g, "/");
  const runtimeDist = path
    .relative(target, path.join(frameworkRoot, "packages/aether_runtime/dist"))
    .replace(/\\/g, "/");

  fs.writeFileSync(
    path.join(target, "package.json"),
    JSON.stringify(
      {
        name: path.basename(target),
        private: true,
        type: "module",
        scripts: {
          dev: `node --experimental-strip-types "${cliEntry}"`,
          build: `node --experimental-strip-types "${cliEntry}" build`,
          migrate: `node --experimental-strip-types "${cliEntry}" migrate`,
        },
        aether: {
          framework: frameworkRoot.replace(/\\/g, "/"),
          runtimeDist,
        },
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(target, "aether.config.json"),
    JSON.stringify(
      {
        root: ".",
        entry: "src/App.tsx",
        state: "src/state.ts",
        bindings: "aether.bindings.json",
        componentsDir: "src",
        outDir: "dist",
        watch: ["src"],
        wasmgc: true,
        server: { port: 5173, host: "0.0.0.0" },
        site: { landing: "public/index.html", publicDir: "public" },
        routes: {
          "/": { type: "static", file: "public/index.html" },
          "/app": { type: "app" },
          "/demo": { type: "app" },
        },
        effects: {
          "db.get": { type: "add", arg: 42 },
        },
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(target, "aether.bindings.json"),
    JSON.stringify(
      {
        derived: [{ target: "doubled", from: "count", op: "mul", arg: 2 }],
        handlers: {
          inc_count: { op: "inc", slot: "count" },
          dec_count: { op: "inc", slot: "count", delta: -1 },
          server_inc_count: { op: "inc", slot: "count", server: true },
          load_remote: { op: "perform", effect: "db.get", into: "remote" },
        },
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(target, "src/state.ts"),
    `export const initialState = {
  count: 0,
  doubled: 0,
  remote: 0,
};
`
  );

  fs.writeFileSync(
    path.join(target, "src/App.tsx"),
    `export default function App() {
  return (
    <div className="app">
      <h1>{count}</h1>
      <p>doubled: {doubled}</p>
      <p>remote: {remote}</p>
      <button onClick={inc_count}>+</button>
      <button onClick={dec_count}>-</button>
      <button onClick={server_inc_count}>+ server</button>
      <button onClick={load_remote}>effect db.get</button>
      <p>
        <a href="/">← docs</a>
      </p>
    </div>
  );
}
`
  );

  fs.writeFileSync(
    path.join(target, "public/index.html"),
    `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${path.basename(target)} — Aether</title>
  <style>
    :root { --bg:#0a0c10; --ink:#eef2f7; --muted:#8b95a8; --accent:#5eead4; --line:#1e2430; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh; font-family: ui-sans-serif, system-ui, sans-serif;
      color: var(--ink);
      background: radial-gradient(800px 400px at 80% -10%, #134e4a55, transparent), var(--bg);
      display: grid; place-items: center; padding: 2rem;
    }
    main { max-width: 36rem; }
    h1 { font-size: 2.5rem; letter-spacing: -0.04em; margin-bottom: 0.75rem; }
    p { color: var(--muted); margin-bottom: 1.25rem; line-height: 1.5; }
    a {
      display: inline-flex; padding: 0.7rem 1.1rem; background: var(--accent);
      color: #042f2e; text-decoration: none; font-weight: 700; border-radius: 0.4rem;
    }
    code { color: #fbbf24; font-family: ui-monospace, monospace; font-size: 0.9em; }
  </style>
</head>
<body>
  <main>
    <h1>${path.basename(target)}</h1>
    <p>
      Приложение на <strong>Aether</strong>. Документация проекта здесь,
      UI — в playground.
    </p>
    <p>Пайплайн: <code>edit src/</code> → HMR compile → Wasm snapshot → DOM patch → DSM.</p>
    <a href="/app">Open app →</a>
  </main>
</body>
</html>
`
  );

  fs.writeFileSync(
    path.join(target, "README.md"),
    `# ${path.basename(target)}

Aether app — developer pipeline:

\`\`\`bash
# 1. framework once
cd ${frameworkRoot.replace(/\\/g, "/")}
cargo build -p aether_compiler
npm run build -w aether_runtime

# 2. this app
cd ${target.replace(/\\/g, "/")}
npm run dev
\`\`\`

| URL | |
|-----|--|
| http://localhost:5173 | docs / landing |
| http://localhost:5173/app | live app |

Edit \`src/App.tsx\`, \`src/state.ts\`, \`aether.bindings.json\`.
`
  );

  console.log(`[Aether] created ${target}`);
  console.log(`  cd ${path.basename(target)}`);
  console.log(`  npm run dev`);
  console.log(`  → http://localhost:5173`);
  process.exit(0);
}

function main() {
  if (COMMAND === "create") return handleCreateCommand();
  if (COMMAND === "migrate") return handleMigrateCommand();
  if (COMMAND === "doctor") {
    const doctor = path.resolve(FRAMEWORK_ROOT, "scripts/doctor.mjs");
    const r = spawnSync(process.execPath, [doctor], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  if (COMMAND === "build") return runCompilation(() => writeProductionBundle());
  if (COMMAND === "deploy") {
    return runCompilation(() => {
      writeProductionBundle();
      const dist = path.resolve(PROJECT_ROOT, "dist_production");
      fs.writeFileSync(
        path.join(dist, "aether.cloud.json"),
        JSON.stringify({ builtAt: new Date().toISOString(), files: fs.readdirSync(dist) }, null, 2)
      );
      console.log("[Aether] deploy manifest written");
    });
  }
  // start | dev | default
  runCompilation(() => startDevServer());
}

main();
