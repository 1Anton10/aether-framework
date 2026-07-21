/**
 * Homepage bench — models Classic VDOM vs Aether dirty+binary costs.
 * Not a microbenchmark of React itself: illustrates the architectural gap.
 */
(function () {
  const range = document.getElementById("bench-range");
  const nLabel = document.getElementById("bench-n");
  const runBtn = document.getElementById("bench-run");
  if (!range || !runBtn) return;

  range.addEventListener("input", () => {
    nLabel.textContent = range.value;
  });

  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(Math.round(n));
  }

  runBtn.addEventListener("click", () => {
    const N = Number(range.value) || 500;
    const FRAMES = 60;
    // Classic: each frame walks ~N vnodes + serializes JSON snapshot of dirty-ish state
    const classicWorkPerFrame = N * 12; // attribute/compare ops model
    const classicBytesPerFrame = N * 24; // JSON {"id":n,"v":n} approx
    const classicTotalWork = classicWorkPerFrame * FRAMES;
    const classicTotalBytes = classicBytesPerFrame * FRAMES;

    // Aether: dirty closure ~sqrt(N) typical fanout model, 12-byte binary delta
    const dirty = Math.max(1, Math.floor(Math.sqrt(N)));
    const aetherWorkPerFrame = dirty * 3;
    const aetherBytesPerFrame = dirty * 12;
    const aetherTotalWork = aetherWorkPerFrame * FRAMES;
    const aetherTotalBytes = aetherBytesPerFrame * FRAMES;

    document.getElementById("old-work").textContent = fmt(classicTotalWork);
    document.getElementById("old-bytes").textContent = fmt(classicTotalBytes) + " B";
    document.getElementById("old-reconcile").textContent = String(FRAMES);
    document.getElementById("new-work").textContent = fmt(aetherTotalWork);
    document.getElementById("new-bytes").textContent = fmt(aetherTotalBytes) + " B";
    document.getElementById("new-patches").textContent = String(dirty * FRAMES);

    const maxWork = Math.max(classicTotalWork, aetherTotalWork);
    const oldBar = document.getElementById("old-bar");
    const newBar = document.getElementById("new-bar");
    oldBar.style.width = "100%";
    newBar.style.width = Math.max(4, (aetherTotalWork / maxWork) * 100) + "%";

    const speedup = (classicTotalWork / aetherTotalWork).toFixed(1);
    const wire = (classicTotalBytes / aetherTotalBytes).toFixed(1);
    document.getElementById("bench-verdict").textContent =
      `При ${N} узлах × ${FRAMES} кадров: ~${speedup}× меньше работы и ~${wire}× меньше байт на проводе (модель dirty DAG + 12B delta).`;
  });
})();
