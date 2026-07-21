/**
 * Aether bench — dirty fan-out vs full edge scan.
 * Run: node --experimental-strip-types packages/aether_bench/bench.ts
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

const N = 50_000;
const { edges, subscribers, hotSlot } = buildSynthetic(N, 3);

const t0 = performance.now();
let a = 0;
for (let i = 0; i < 200; i++) a += fullScan(edges, hotSlot);
const t1 = performance.now();
let b = 0;
for (let i = 0; i < 200; i++) b += dirtyFanout(subscribers, hotSlot);
const t2 = performance.now();

console.log(
  JSON.stringify(
    {
      edges: N,
      fullScanMs: +(t1 - t0).toFixed(3),
      dirtyFanoutMs: +(t2 - t1).toFixed(3),
      hits: a / 200,
      speedup: +((t1 - t0) / Math.max(t2 - t1, 0.0001)).toFixed(1),
      gate: b === a && t2 - t1 < t1 - t0,
    },
    null,
    2
  )
);
