/**
 * Aether Runtime — core-ready
 * Snapshot resume · dirty+derived DAG · effects · WS/HTTP DSM · live reload
 */

import { createRouter, bindLinks } from "./router";

export type Id = { "0"?: number } | number;

function nid(id: Id): number {
  return typeof id === "number" ? id : id["0"] ?? 0;
}

export function encodeDeltas(deltas: Array<[number, number]>): Uint8Array {
  const buf = new ArrayBuffer(deltas.length * 12);
  const view = new DataView(buf);
  let o = 0;
  for (const [slot, value] of deltas) {
    view.setUint32(o, slot, true);
    view.setUint32(o + 4, 4, true);
    view.setInt32(o + 8, value, true);
    o += 12;
  }
  return new Uint8Array(buf);
}

export function decodeDeltas(bytes: Uint8Array): Array<[number, number]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i + 8 <= bytes.byteLength) {
    const slot = view.getUint32(i, true);
    const len = view.getUint32(i + 4, true);
    i += 8;
    if (i + len > bytes.byteLength) break;
    out.push([slot, len >= 4 ? view.getInt32(i, true) : 0]);
    i += len;
  }
  return out;
}

export function encodeEffectRequest(
  effect: string,
  resumeSlot: number,
  payload: number
): Uint8Array {
  const name = new TextEncoder().encode(effect);
  const buf = new Uint8Array(2 + name.length + 8);
  const view = new DataView(buf.buffer);
  view.setUint16(0, name.length, true);
  buf.set(name, 2);
  view.setUint32(2 + name.length, resumeSlot, true);
  view.setInt32(2 + name.length + 4, payload, true);
  return buf;
}

export function decodeEffectRequest(
  bytes: Uint8Array
): { effect: string; resumeSlot: number; payload: number } | null {
  if (bytes.byteLength < 2) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint16(0, true);
  if (bytes.byteLength < 2 + n + 8) return null;
  const effect = new TextDecoder().decode(bytes.subarray(2, 2 + n));
  const resumeSlot = view.getUint32(2 + n, true);
  const payload = view.getInt32(2 + n + 4, true);
  return { effect, resumeSlot, payload };
}

interface Slot {
  id: Id;
  name: string;
  offset: number;
}
interface ReactiveEdge {
  SlotToText?: { slot: Id; node: Id };
  SlotToAttr?: { slot: Id; node: Id; attr: string };
}
interface DerivedSlot {
  target: Id;
  sources: Id[];
  op: { Copy?: null; Mul?: number; Add?: number } | string;
}
interface EffectOp {
  LocalMutate?: { slot: Id; delta: number };
  LocalSet?: { slot: Id; value: number };
  ServerMutate?: { slot: Id; action: string; delta: number };
  Perform?: { effect: string; resume_slot: Id };
}
interface AetherProgram {
  root: Id;
  nodes: any[];
  slots: Slot[];
  edges: ReactiveEdge[];
  subscribers?: number[][];
  propagates_to?: number[][];
  derived?: DerivedSlot[];
  effects: Record<string, EffectOp>;
  memory_bytes: number;
}

class DirtyQueue {
  private dirty = new Set<number>();
  private scheduled = false;
  constructor(private flush: (slots: number[]) => void) {}
  mark(slotId: number) {
    this.dirty.add(slotId);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        const batch = [...this.dirty];
        this.dirty.clear();
        if (batch.length) this.flush(batch);
      });
    }
  }
}

/** Prefer WebTransport (HTTP/3) → WS /aether-dsm → WS /api/dsm → HTTP. Same binary codec. */
class DsmTransport {
  private ws: WebSocket | null = null;
  private wt: any = null;
  private wtWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private ready = false;
  transport: "webtransport" | "ws-dsm" | "ws-api" | "http" = "http";
  onMessage: ((bytes: Uint8Array) => void) | null = null;

  private openWs(url: string, label: "ws-dsm" | "ws-api"): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const sock = new WebSocket(url);
        sock.binaryType = "arraybuffer";
        const t = setTimeout(() => {
          try {
            sock.close();
          } catch {
            /* */
          }
          resolve(false);
        }, 1500);
        sock.onopen = () => {
          clearTimeout(t);
          this.ws = sock;
          this.ready = true;
          this.transport = label;
          sock.onmessage = (ev) => {
            if (this.onMessage && ev.data instanceof ArrayBuffer) {
              this.onMessage(new Uint8Array(ev.data));
            }
          };
          sock.onclose = () => {
            this.ready = false;
          };
          resolve(true);
        };
        sock.onerror = () => {
          clearTimeout(t);
          resolve(false);
        };
      } catch {
        resolve(false);
      }
    });
  }

  async connect() {
    // Native WebTransport (HTTP/3) when available over https
    if (typeof WebTransport !== "undefined" && location.protocol === "https:") {
      try {
        this.wt = new WebTransport(`${location.origin}/aether-dsm`);
        await this.wt.ready;
        const reader = this.wt.datagrams.readable.getReader();
        this.wtWriter = this.wt.datagrams.writable.getWriter();
        this.ready = true;
        this.transport = "webtransport";
        void (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value && this.onMessage) this.onMessage(value);
          }
        })();
        return;
      } catch {
        this.wt = null;
      }
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    if (await this.openWs(`${proto}://${location.host}/aether-dsm`, "ws-dsm")) return;
    if (await this.openWs(`${proto}://${location.host}/api/dsm`, "ws-api")) return;
    this.transport = "http";
  }

  async sendDeltas(deltas: Array<[number, number]>, action?: string): Promise<Uint8Array> {
    // Always HTTP for mutate round-trip so the client gets the server binary
    // response (byte size + applied deltas). WS/WT remain receive channels.
    const body = encodeDeltas(deltas);
    const res = await fetch("/api/delta", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        ...(action ? { "X-Aether-Action": action } : {}),
      },
      body,
    });
    const out = new Uint8Array(await res.arrayBuffer());
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("aether:dsm", {
          detail: {
            action: action || "delta",
            reqBytes: body.byteLength,
            resBytes: out.byteLength,
            transport: "http",
          },
        })
      );
    }
    return out;
  }

  async perform(
    effect: string,
    resumeSlot: number,
    payload: number
  ): Promise<Array<[number, number]>> {
    // Effects always use HTTP request/response so the host can return
    // X-Aether-Effect-Mode (e.g. rtt) and the client can measure wall-clock RTT.
    // WS/WT are for DSM deltas only — fire-and-forget there drops RTT to 0.
    const body = encodeEffectRequest(effect, resumeSlot, payload);
    const t0 = performance.now();
    const res = await fetch("/api/effect", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const mode = (res.headers.get("X-Aether-Effect-Mode") || "value").toLowerCase();
    if (mode === "rtt") {
      const ms = Math.max(1, Math.round(performance.now() - t0));
      return [[resumeSlot, ms]];
    }
    return decodeDeltas(buf);
  }
}

export class AetherRuntime {
  program: AetherProgram | null = null;
  private memory: WebAssembly.Memory | null = null;
  private domHandles = new Map<number, Node>();
  private exports: Record<string, Function> = {};
  private queue: DirtyQueue | null = null;
  private dsm = new DsmTransport();
  private effectNames = new Map<number, string>();
  patchCount = 0;

  constructor() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => void this.init());
    } else {
      void this.init();
    }
  }

  private async init() {
    this.connectLiveReload();
    await this.dsm.connect();
    this.dsm.onMessage = (bytes) => {
      if (bytes[0] === 0xef) {
        const req = decodeEffectRequest(bytes.subarray(1));
        if (req) this.applyHostDelta(req.resumeSlot, req.payload);
        return;
      }
      for (const [s, v] of decodeDeltas(bytes)) this.applyHostDelta(s, v);
    };

    const programRes = await fetch("/aether.program.json");
    if (!programRes.ok) {
      console.error("[Aether] missing program");
      return;
    }
    this.program = (await programRes.json()) as AetherProgram;
    // Rebuild effect id → name map (matches compiler sort order)
    const performEffects = Object.values(this.program.effects || {})
      .map((e) => e.Perform?.effect)
      .filter(Boolean) as string[];
    const unique = [...new Set(performEffects)].sort();
    unique.forEach((name, i) => this.effectNames.set(i + 1, name));

    if (!this.program.subscribers) {
      this.program.subscribers = this.buildSubscribers(this.program);
    }
    if (!this.program.propagates_to) {
      this.program.propagates_to = this.buildPropagates(this.program);
    }

    const snapshotEl = document.querySelector(
      'script[type="aether/snapshot"]'
    ) as HTMLScriptElement | null;
    let snapshot: Uint8Array | null = null;
    if (snapshotEl?.textContent?.trim()) {
      const bin = atob(snapshotEl.textContent.trim());
      snapshot = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) snapshot[i] = bin.charCodeAt(i);
    }

    const imports = {
      env: {
        dom_set_text: (nodeId: number, ptr: number, len: number) =>
          this.domSetText(nodeId, ptr, len),
        dom_set_attr: (
          nodeId: number,
          namePtr: number,
          nameLen: number,
          valPtr: number,
          valLen: number
        ) => this.domSetAttr(nodeId, namePtr, nameLen, valPtr, valLen),
        aether_perform: (
          effectPtr: number,
          effectLen: number,
          resumeSlot: number,
          payload: number
        ) => {
          const name = new TextDecoder().decode(this.readBytes(effectPtr, effectLen));
          void this.runPerform(name, resumeSlot, payload);
        },
        /** CPS yield from Wasm — algebraic effect suspend */
        aether_suspend: (effectId: number, resumeSlot: number, payload: number) => {
          const name =
            this.effectNames.get(effectId) ||
            this.program?.effects &&
              Object.values(this.program.effects).find((e) => e.Perform)?.Perform?.effect ||
            `effect_${effectId}`;
          void this.runPerform(String(name), resumeSlot, payload);
        },
      },
    };

    let wasmBuf: ArrayBuffer | null = null;
    let usedGc = false;
    if ((this.program as any).wasm_gc) {
      try {
        const gcRes = await fetch("/app.gc.wasm");
        if (gcRes.ok) {
          wasmBuf = await gcRes.arrayBuffer();
          usedGc = true;
        }
      } catch {
        /* linear fallback */
      }
    }
    if (!wasmBuf) {
      const wasmRes = await fetch("/app.wasm");
      if (!wasmRes.ok) {
        console.error("[Aether] missing wasm");
        return;
      }
      wasmBuf = await wasmRes.arrayBuffer();
    }

    let instance: WebAssembly.Instance;
    try {
      ({ instance } = await WebAssembly.instantiate(wasmBuf, imports));
    } catch (err) {
      if (usedGc) {
        console.warn("[Aether] WasmGC instantiate failed, falling back to linear", err);
        const wasmRes = await fetch("/app.wasm");
        try {
          ({ instance } = await WebAssembly.instantiate(await wasmRes.arrayBuffer(), imports));
        } catch (err2: any) {
          const msg = String(err2?.message || err2);
          if (msg.includes("Content Security Policy") || msg.includes("unsafe-eval")) {
            throw new Error(
              "[Aether] WebAssembly blocked by CSP. Add 'wasm-unsafe-eval' to script-src (see docs/ABI.md §9)."
            );
          }
          throw err2;
        }
        usedGc = false;
      } else {
        throw err;
      }
    }
    this.memory = instance.exports.memory as WebAssembly.Memory;
    for (const [k, v] of Object.entries(instance.exports)) {
      if (typeof v === "function") this.exports[k] = v as Function;
    }

    // Always init (allocates GC array when present), then restore linear snapshot & resync slots.
    if (this.exports.aether_init) this.exports.aether_init();
    if (snapshot && this.memory) {
      const heap = new Uint8Array(this.memory.buffer);
      heap.set(snapshot.subarray(0, Math.min(snapshot.length, this.program.memory_bytes)), 0);
      if (usedGc && this.exports.apply_delta) {
        const view = new DataView(this.memory.buffer);
        for (const slot of this.program.slots) {
          const id = nid(slot.id);
          const v = view.getInt32(slot.offset, true);
          (this.exports.apply_delta as (s: number, v: number) => void)(id, v);
        }
      }
    }

    this.recomputeAllDerived();
    this.queue = new DirtyQueue((slots) => this.flushDirty(slots));
    this.mount();
    this.setupListeners();
    if (typeof globalThis !== "undefined") {
      (globalThis as any).__AETHER__ = this;
    }
  }

  private connectLiveReload() {
    try {
      const es = new EventSource("/api/live-reload");
      es.onmessage = () => location.reload();
    } catch {
      /* optional */
    }
  }

  private buildSubscribers(p: AetherProgram): number[][] {
    const subs: number[][] = p.slots.map(() => []);
    p.edges.forEach((edge, idx) => {
      const slot = edge.SlotToText
        ? nid(edge.SlotToText.slot)
        : edge.SlotToAttr
          ? nid(edge.SlotToAttr.slot)
          : -1;
      if (slot >= 0) subs[slot].push(idx);
    });
    return subs;
  }

  private buildPropagates(p: AetherProgram): number[][] {
    const prop: number[][] = p.slots.map(() => []);
    for (const d of p.derived || []) {
      for (const s of d.sources) prop[nid(s)].push(nid(d.target));
    }
    return prop;
  }

  private dirtyClosure(root: number): number[] {
    const seen = new Set<number>();
    const q = [root];
    const out: number[] = [];
    while (q.length) {
      const s = q.shift()!;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      for (const t of this.program?.propagates_to?.[s] || []) q.push(t);
    }
    return out;
  }

  private readI32(ptr: number): number {
    return this.memory
      ? new DataView(this.memory.buffer).getInt32(ptr, true)
      : 0;
  }

  private readBytes(ptr: number, len: number): Uint8Array {
    if (!this.memory) return new Uint8Array();
    return new Uint8Array(this.memory.buffer, ptr, len);
  }

  private slotValue(slotId: number): number {
    const slot = this.program?.slots.find((s) => nid(s.id) === slotId);
    return slot ? this.readI32(slot.offset) : 0;
  }

  private writeSlot(slotId: number, value: number) {
    const slot = this.program?.slots.find((s) => nid(s.id) === slotId);
    if (!slot || !this.memory) return;
    new DataView(this.memory.buffer).setInt32(slot.offset, value, true);
  }

  private derivedOp(d: DerivedSlot, srcVal: number): number {
    const op: any = d.op;
    if (op === "Copy" || op?.Copy !== undefined) return srcVal;
    if (typeof op?.Mul === "number") return srcVal * op.Mul;
    if (typeof op?.Add === "number") return srcVal + op.Add;
    return srcVal;
  }

  private recomputeDerivedFrom(dirtyRoot: number) {
    if (!this.program?.derived?.length) return;
    const closure = new Set(this.dirtyClosure(dirtyRoot));
    for (const d of this.program.derived) {
      const target = nid(d.target);
      if (!closure.has(target)) continue;
      const src = nid(d.sources[0]);
      this.writeSlot(target, this.derivedOp(d, this.slotValue(src)));
    }
  }

  private recomputeAllDerived() {
    if (!this.program?.derived?.length) return;
    for (const d of this.program.derived) {
      const src = nid(d.sources[0]);
      this.writeSlot(nid(d.target), this.derivedOp(d, this.slotValue(src)));
    }
  }

  private domSetText(nodeId: number, ptr: number, len: number) {
    const handle = this.domHandles.get(nodeId);
    if (!handle) return;
    handle.textContent =
      len === 4
        ? String(this.readI32(ptr))
        : new TextDecoder().decode(this.readBytes(ptr, len));
    this.patchCount++;
  }

  private domSetAttr(
    nodeId: number,
    namePtr: number,
    nameLen: number,
    valPtr: number,
    valLen: number
  ) {
    const handle = this.domHandles.get(nodeId);
    if (!handle || !(handle instanceof Element)) return;
    const name = new TextDecoder().decode(this.readBytes(namePtr, nameLen));
    const value =
      valLen === 4
        ? String(this.readI32(valPtr))
        : new TextDecoder().decode(this.readBytes(valPtr, valLen));
    handle.setAttribute(name, value);
    this.patchCount++;
  }

  private flushDirty(slotIds: number[]) {
    if (!this.program) return;
    const all = new Set<number>();
    for (const s of slotIds) for (const x of this.dirtyClosure(s)) all.add(x);
    for (const s of slotIds) this.recomputeDerivedFrom(s);
    for (const slotId of all) {
      const value = this.slotValue(slotId);
      for (const ei of this.program.subscribers?.[slotId] || []) {
        const edge = this.program.edges[ei];
        if (edge?.SlotToText) {
          const h = this.domHandles.get(nid(edge.SlotToText.node));
          if (h) {
            h.textContent = String(value);
            this.patchCount++;
          }
        } else if (edge?.SlotToAttr) {
          const h = this.domHandles.get(nid(edge.SlotToAttr.node));
          if (h instanceof Element) {
            h.setAttribute(edge.SlotToAttr.attr, String(value));
            this.patchCount++;
          }
        }
      }
      const slot = this.program.slots.find((s) => nid(s.id) === slotId);
      if (slot) {
        for (const [tid, meta] of this.loopRoots) {
          if (meta.collection === slot.name) this.syncLoop(tid);
        }
        for (const [tid, meta] of this.condRoots) {
          if (meta.slot === slot.name) this.syncCond(tid);
        }
      }
    }
  }

  private loopRoots = new Map<
    number,
    { parent: Element; collection: string; instances: Node[]; templateId: number }
  >();

  private condRoots = new Map<
    number,
    { parent: Element; slot: string; instance: Node | null; templateId: number }
  >();

  private controlFlow(node: any): { kind: string; collection?: string; item?: string } {
    const cf = node?.control_flow;
    if (!cf || cf === "None") return { kind: "None" };
    if (cf.Loop) {
      const [collection, item] = cf.Loop as [string, string];
      return { kind: "Loop", collection, item };
    }
    if (cf.Condition) return { kind: "Condition", collection: cf.Condition };
    return { kind: "None" };
  }

  private cloneTemplate(templateId: number, loopIndex = -1): Node | null {
    return this.buildNodeInner(templateId, true, loopIndex);
  }

  /** Normative max list clones (ABI §6). */
  static readonly LOOP_CAP = 64;

  private syncLoop(templateId: number) {
    const meta = this.loopRoots.get(templateId);
    if (!meta || !this.program) return;
    const slot = this.program.slots.find((s) => s.name === meta.collection);
    const n = Math.max(
      0,
      Math.min(slot ? this.slotValue(nid(slot.id)) : 0, AetherRuntime.LOOP_CAP)
    );
    while (meta.instances.length < n) {
      const idx = meta.instances.length;
      const clone = this.cloneTemplate(templateId, idx);
      if (!clone) break;
      meta.parent.appendChild(clone);
      meta.instances.push(clone);
    }
    while (meta.instances.length > n) {
      const last = meta.instances.pop()!;
      last.parentNode?.removeChild(last);
    }
  }

  private syncCond(templateId: number) {
    const meta = this.condRoots.get(templateId);
    if (!meta || !this.program) return;
    const slot = this.program.slots.find((s) => s.name === meta.slot);
    const show = slot ? this.slotValue(nid(slot.id)) !== 0 : false;
    if (show && !meta.instance) {
      const clone = this.cloneTemplate(templateId, -1);
      if (clone) {
        meta.parent.appendChild(clone);
        meta.instance = clone;
      }
    } else if (!show && meta.instance) {
      meta.instance.parentNode?.removeChild(meta.instance);
      meta.instance = null;
    }
  }

  private mount() {
    if (!this.program) return;
    const rootEl = document.getElementById("root");
    if (!rootEl) return;

    // Hydrate SSR markup when present (no flash / no full rebuild)
    if (rootEl.getAttribute("data-aether-ssr") === "1" && rootEl.childNodes.length) {
      this.hydrate(rootEl);
      return;
    }

    rootEl.replaceChildren();
    const built = this.buildNode(nid(this.program.root));
    if (built) rootEl.appendChild(built);
  }

  /** Adopt server-rendered nodes marked with data-aether-nid. */
  private hydrate(rootEl: HTMLElement) {
    const marked = rootEl.querySelectorAll("[data-aether-nid]");
    marked.forEach((el) => {
      const id = Number(el.getAttribute("data-aether-nid"));
      if (!Number.isFinite(id)) return;
      // Text nodes were wrapped in <span data-aether-nid> — use text child if single
      if (
        el.tagName === "SPAN" &&
        el.childNodes.length === 1 &&
        el.firstChild?.nodeType === Node.TEXT_NODE
      ) {
        this.domHandles.set(id, el.firstChild);
      } else {
        this.domHandles.set(id, el);
      }
    });
    // Fallback: if root program node missing, full mount
    if (!this.domHandles.has(nid(this.program!.root))) {
      rootEl.replaceChildren();
      const built = this.buildNode(nid(this.program!.root));
      if (built) rootEl.appendChild(built);
      return;
    }
    // Register Loop / Condition regions from SSR, then sync.
    this.adoptControlFlow(nid(this.program!.root));
  }

  /** Walk IR after hydrate: adopt SSR Loop/Condition clones and sync. */
  private adoptControlFlow(nodeId: number) {
    if (!this.program) return;
    const node = this.program.nodes[nodeId];
    if (!node) return;
    const parentHandle = this.domHandles.get(nodeId);
    for (const childIdRaw of node.children || []) {
      const childId = nid(childIdRaw);
      const childNode = this.program.nodes[childId];
      const cf = this.controlFlow(childNode);
      if (cf.kind === "Loop" && cf.collection && parentHandle instanceof Element) {
        const instances: Node[] = [];
        for (const child of Array.from(parentHandle.childNodes)) {
          if (child.nodeType !== Node.ELEMENT_NODE) continue;
          const el = child as Element;
          if (el.getAttribute("data-aether-nid") === String(childId)) {
            instances.push(child);
          }
        }
        this.loopRoots.set(childId, {
          parent: parentHandle,
          collection: cf.collection,
          instances,
          templateId: childId,
        });
        this.syncLoop(childId);
        continue;
      }
      if (cf.kind === "Condition" && cf.collection && parentHandle instanceof Element) {
        let instance: Node | null = null;
        for (const child of Array.from(parentHandle.childNodes)) {
          if (child.nodeType !== Node.ELEMENT_NODE) continue;
          const el = child as Element;
          if (el.getAttribute("data-aether-nid") === String(childId)) {
            instance = child;
            break;
          }
        }
        this.condRoots.set(childId, {
          parent: parentHandle,
          slot: cf.collection,
          instance,
          templateId: childId,
        });
        this.syncCond(childId);
        continue;
      }
      this.adoptControlFlow(childId);
    }
  }

  private buildNode(id: number): Node | null {
    return this.buildNodeInner(id, false, -1);
  }

  private buildNodeInner(id: number, asClone: boolean, loopIndex: number): Node | null {
    if (!this.program) return null;
    const node = this.program.nodes[id];
    if (!node) return null;
    const nt = node.node_type;

    if (nt.Text) {
      const binding = nt.Text;
      let text = "";
      if (binding.Static !== undefined) text = binding.Static;
      else if (binding.Expression === "$item" || binding.Expression?.startsWith?.("$item")) {
        text = loopIndex >= 0 ? String(loopIndex + 1) : "";
      } else if (binding.Reactive !== undefined) {
        const slot = this.program.slots.find((s) => s.name === binding.Reactive);
        text = slot ? String(this.slotValue(nid(slot.id))) : "";
      }
      const tn = document.createTextNode(text);
      if (!asClone) this.domHandles.set(id, tn);
      return tn;
    }

    if (nt.Element) {
      const { tag, props, events } = nt.Element;
      const el = document.createElement(String(tag).toLowerCase());
      if (props) {
        for (const [k, v] of Object.entries(props) as [string, any][]) {
          const attr = k === "className" ? "class" : k;
          if (v.Static !== undefined) el.setAttribute(attr, v.Static);
          else if (v.Expression === "$item") {
            if (loopIndex >= 0) el.setAttribute(attr, String(loopIndex + 1));
          } else if (v.Reactive !== undefined) {
            const slot = this.program.slots.find((s) => s.name === v.Reactive);
            if (slot) el.setAttribute(attr, String(this.slotValue(nid(slot.id))));
          }
        }
      }
      if (events) {
        for (const [ev, handler] of Object.entries(events) as [string, any][]) {
          const name = handler.Local || handler.Server || "";
          el.setAttribute(`data-ae-${ev}`, name);
          if (handler.Server) el.setAttribute("data-ae-server", "1");
          const op = this.program!.effects[name];
          if (op?.Perform) el.setAttribute("data-ae-effect", "1");
        }
      }
      if (!asClone) this.domHandles.set(id, el);
      for (const childIdRaw of node.children || []) {
        const childId = nid(childIdRaw);
        const childNode = this.program.nodes[childId];
        const childCf = this.controlFlow(childNode);
        if (childCf.kind === "Loop" && childCf.collection && !asClone) {
          this.loopRoots.set(childId, {
            parent: el,
            collection: childCf.collection,
            instances: [],
            templateId: childId,
          });
          this.syncLoop(childId);
          continue;
        }
        if (childCf.kind === "Condition" && childCf.collection && !asClone) {
          this.condRoots.set(childId, {
            parent: el,
            slot: childCf.collection,
            instance: null,
            templateId: childId,
          });
          this.syncCond(childId);
          continue;
        }
        const child = this.buildNodeInner(childId, asClone, loopIndex);
        if (child) el.appendChild(child);
      }
      return el;
    }
    return null;
  }

  applyHostDelta(slotId: number, value: number) {
    if (this.exports.apply_delta) {
      this.exports.apply_delta(slotId, value);
      this.recomputeDerivedFrom(slotId);
      // Patch derived subscribers via queue
      for (const s of this.dirtyClosure(slotId)) {
        if (s !== slotId) this.queue?.mark(s);
      }
      this.queue?.mark(slotId);
      return;
    }
    this.writeSlot(slotId, value);
    this.queue?.mark(slotId);
  }

  private async runPerform(effect: string, resumeSlot: number, payload: number) {
    const deltas = await this.dsm.perform(effect, resumeSlot, payload);
    for (const [s, v] of deltas) {
      // Always go through applyHostDelta so memory + dirty DOM queue stay in sync.
      // aether_resume alone updates Wasm memory without patching text nodes.
      this.applyHostDelta(s, v);
    }
  }

  private setupListeners() {
    document.addEventListener("click", async (event) => {
      const target = event.target as HTMLElement | null;
      if (!target || !this.program) return;
      const handlerName = target.getAttribute("data-ae-click");
      if (!handlerName) return;
      const effect = this.program.effects[handlerName];

      if (effect?.Perform || target.getAttribute("data-ae-effect") === "1") {
        const perf = effect?.Perform;
        if (!perf) return;
        await this.runPerform(perf.effect, nid(perf.resume_slot), this.slotValue(nid(perf.resume_slot)));
        return;
      }

      if (effect?.ServerMutate || target.getAttribute("data-ae-server") === "1") {
        const slotId = effect?.ServerMutate ? nid(effect.ServerMutate.slot) : 0;
        const delta = effect?.ServerMutate?.delta ?? 1;
        const next = this.slotValue(slotId) + delta;
        const resp = await this.dsm.sendDeltas([[slotId, next]], handlerName);
        for (const [s, v] of decodeDeltas(resp)) this.applyHostDelta(s, v);
        return;
      }

      if (this.exports[handlerName]) {
        this.exports[handlerName]();
        const slot = effect?.LocalMutate
          ? nid(effect.LocalMutate.slot)
          : effect?.LocalSet
            ? nid(effect.LocalSet.slot)
            : 0;
        this.recomputeDerivedFrom(slot);
        for (const s of this.dirtyClosure(slot)) this.queue?.mark(s);
        return;
      }

      if (effect?.LocalSet) {
        this.applyHostDelta(nid(effect.LocalSet.slot), effect.LocalSet.value ?? 0);
        return;
      }

      if (effect?.LocalMutate) {
        const slotId = nid(effect.LocalMutate.slot);
        this.applyHostDelta(slotId, this.slotValue(slotId) + (effect.LocalMutate.delta ?? 1));
      }
    });
  }
}

new AetherRuntime();

export { createRouter, bindLinks };
if (typeof window !== "undefined") {
  (window as any).AetherRouter = { createRouter, bindLinks };
}
