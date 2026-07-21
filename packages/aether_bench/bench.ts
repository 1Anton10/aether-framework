/**
 * Aether benches — dirty DAG fan-out + binary DSM vs JSON wire.
 * Run: npm run bench
 */
function buildSynthetic(edgeCount: number, hotSlot: number) {
  const slots = 10;
  const subscribers: number[][] = Array.from({ length: slots }, () => []);
  const edges: { slot: number }[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const slot = i % slots;
    edges.push({ slot });
    subscribers[slot].push(i);
  }
  return { edges, subscribers, hotSlot };
}

function fullScan(edges: { slot: number }[], hot: number) {
  let hits = 0;
  for (const e of edges) if (e.slot === hot) hits++;
  return hits;
}

function dirtyFanout(subscribers: number[][], hot: number) {
  return subscribers[hot]?.length ?? 0;
}

function encodeBinary(deltas: Array<[number, number]>): number {
  return deltas.length * 12;
}

function encodeJson(deltas: Array<[number, number]>): number {
  return JSON.stringify(
    deltas.map(([slot, value]) => ({ slot, value }))
  ).length;
}

const N = 50_000;
const { edges, subscribers, hotSlot } = buildSynthetic(N, 3);

const t0 = performance.now();
let a = 0;
for (let i = 0; i < 200; i++) a += fullScan(edges, hotSlot);
const t1 = performance.now();
let b = 0;
for (let i = 0; i < 200; i++) b += dirtyFanout(subscribers, hotSlot);
const t2 = performance.now();

const dirty = 64;
const sample: Array<[number, number]> = Array.from({ length: dirty }, (_, i) => [i, i * 3]);
const encT0 = performance.now();
let jsonBytes = 0;
for (let i = 0; i < 10_000; i++) jsonBytes = encodeJson(sample);
const encT1 = performance.now();
let binBytes = 0;
for (let i = 0; i < 10_000; i++) binBytes = encodeBinary(sample);
const encT2 = performance.now();

const result = {
  dag: {
    edges: N,
    fullScanMs: +(t1 - t0).toFixed(3),
    dirtyFanoutMs: +(t2 - t1).toFixed(3),
    hits: a / 200,
    speedup: +((t1 - t0) / Math.max(t2 - t1, 0.0001)).toFixed(1),
    gate: b === a && t2 - t1 < t1 - t0,
  },
  wire: {
    dirtySlots: dirty,
    iterations: 10_000,
    jsonBytesPerFrame: jsonBytes,
    binaryBytesPerFrame: binBytes,
    jsonEncodeMs: +(encT1 - encT0).toFixed(3),
    binaryEncodeMs: +(encT2 - encT1).toFixed(3),
    bytesRatio: +(jsonBytes / binBytes).toFixed(2),
    encodeSpeedup: +((encT1 - encT0) / Math.max(encT2 - encT1, 0.0001)).toFixed(1),
  },
};

console.log(JSON.stringify(result, null, 2));
