/**
 * Live browser measure — Classic full reconcile+JSON vs Aether dirty patch+binary.
 * Runs real DOM writes and payload encoding in this tab (not a formula).
 */
(function () {
  const range = document.getElementById("bench-range");
  const nLabel = document.getElementById("bench-n");
  const runBtn = document.getElementById("bench-run");
  const host = document.getElementById("bench-host");
  if (!range || !runBtn) return;

  range.addEventListener("input", () => {
    nLabel.textContent = range.value;
  });

  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(Math.round(n));
  }

  function fmtMs(ms) {
    if (ms < 1) return ms.toFixed(2) + " ms";
    if (ms < 100) return ms.toFixed(1) + " ms";
    return Math.round(ms) + " ms";
  }

  function encodeBinaryDeltas(slots, values) {
    const buf = new ArrayBuffer(slots.length * 12);
    const view = new DataView(buf);
    let o = 0;
    for (let i = 0; i < slots.length; i++) {
      view.setUint32(o, slots[i], true);
      view.setUint32(o + 4, 4, true);
      view.setInt32(o + 8, values[i] | 0, true);
      o += 12;
    }
    return buf.byteLength;
  }

  function buildDom(n) {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none";
    wrap.setAttribute("aria-hidden", "true");
    const nodes = [];
    for (let i = 0; i < n; i++) {
      const el = document.createElement("span");
      el.textContent = "0";
      wrap.appendChild(el);
      nodes.push(el);
    }
    document.body.appendChild(wrap);
    return { wrap, nodes };
  }

  /** Classic SPA-shaped work: touch every node + JSON snapshot every frame. */
  function measureClassic(nodes, values, frames) {
    let bytes = 0;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const snapshot = new Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        const v = (values[i] + f) | 0;
        snapshot[i] = { id: i, v };
        // full tree walk + write (VDOM-style “everything might have changed”)
        nodes[i].textContent = String(v);
      }
      bytes += JSON.stringify(snapshot).length;
    }
    return { ms: performance.now() - t0, bytes, patches: nodes.length * frames };
  }

  /** Aether-shaped work: dirty subset only + 12-byte binary deltas. */
  function measureAether(nodes, values, frames, dirtyIdx) {
    let bytes = 0;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const slots = dirtyIdx;
      const vals = new Array(dirtyIdx.length);
      for (let k = 0; k < dirtyIdx.length; k++) {
        const i = dirtyIdx[k];
        const v = (values[i] + f) | 0;
        vals[k] = v;
        nodes[i].textContent = String(v);
      }
      bytes += encodeBinaryDeltas(slots, vals);
    }
    return {
      ms: performance.now() - t0,
      bytes,
      patches: dirtyIdx.length * frames,
    };
  }

  /** Live DSM: POST binary frames to /api/delta (same codec as production). */
  async function measureLiveDsm(frames, dirtyCount) {
    const body = new Uint8Array(dirtyCount * 12);
    const view = new DataView(body.buffer);
    for (let i = 0; i < dirtyCount; i++) {
      view.setUint32(i * 12, i % 8, true);
      view.setUint32(i * 12 + 4, 4, true);
      view.setInt32(i * 12 + 8, i, true);
    }
    let bytes = 0;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const res = await fetch("/api/delta", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body,
      });
      const ab = await res.arrayBuffer();
      bytes += body.byteLength + ab.byteLength;
      if (!res.ok) throw new Error("delta " + res.status);
    }
    return { ms: performance.now() - t0, bytes };
  }

  runBtn.addEventListener("click", async () => {
    const N = Number(range.value) || 500;
    const FRAMES = 60;
    runBtn.disabled = true;
    const verdict = document.getElementById("bench-verdict");
    verdict.textContent = "Измерение…";

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const values = new Int32Array(N);
    for (let i = 0; i < N; i++) values[i] = i % 97;
    const dirtyN = Math.max(1, Math.floor(Math.sqrt(N)));
    const dirtyIdx = [];
    for (let i = 0; i < dirtyN; i++) dirtyIdx.push(Math.floor((i * N) / dirtyN) % N);

    const { wrap, nodes } = buildDom(N);
    let classic;
    let aether;
    try {
      classic = measureClassic(nodes, values, FRAMES);
      aether = measureAether(nodes, values, FRAMES, dirtyIdx);
    } finally {
      wrap.remove();
    }

    document.getElementById("old-work").textContent = fmtMs(classic.ms);
    document.getElementById("old-bytes").textContent = fmt(classic.bytes) + " B";
    document.getElementById("old-reconcile").textContent = String(FRAMES);
    document.getElementById("old-hydrate").textContent = "full walk";

    document.getElementById("new-work").textContent = fmtMs(aether.ms);
    document.getElementById("new-bytes").textContent = fmt(aether.bytes) + " B";
    document.getElementById("new-patches").textContent = String(aether.patches);
    document.getElementById("new-hydrate").textContent = "dirty only";

    const maxMs = Math.max(classic.ms, aether.ms, 0.001);
    document.getElementById("old-bar").style.width = "100%";
    document.getElementById("new-bar").style.width =
      Math.max(4, (aether.ms / maxMs) * 100) + "%";

    const speedup = classic.ms / Math.max(aether.ms, 0.001);
    const wire = classic.bytes / Math.max(aether.bytes, 1);

    let liveLine = "";
    try {
      const live = await measureLiveDsm(Math.min(FRAMES, 20), dirtyN);
      liveLine =
        ` · live /api/delta ${Math.min(FRAMES, 20)}×: ${fmtMs(live.ms)}, ${fmt(live.bytes)} B`;
      if (host) host.textContent = "DSM live OK";
    } catch {
      liveLine = " · live DSM: server offline";
      if (host) host.textContent = "DOM-only (no DSM)";
    }

    verdict.textContent =
      `Реально в этом браузере · ${N} узлов × ${FRAMES} кадров: ` +
      `DOM ${speedup.toFixed(1)}× быстрее, payload ${wire.toFixed(1)}× меньше` +
      liveLine;

    runBtn.disabled = false;
  });

  // Independent public bench numbers (npm run bench:public → site/bench-results.json)
  fetch("/bench-results.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const el = document.getElementById("bench-public");
      if (!el || !data?.dag) return;
      el.textContent =
        `Публичный прогон (${data.platform}/${data.arch}, ${data.generatedAt?.slice(0, 10)}): ` +
        `DAG ×${data.dag.speedup}, wire encode ×${data.wire?.encodeSpeedup}, ` +
        `${data.wire?.jsonBytesPerFrame}→${data.wire?.binaryBytesPerFrame} B/frame. ` +
        `Переснимите: npm run bench:public`;
    })
    .catch(() => {});
})();
