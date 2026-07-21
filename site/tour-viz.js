/**
 * Demo visuals — slots from Wasm DOM patches + real HTTP APIs.
 */
(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function num(el) {
    if (!el) return 0;
    const n = parseInt(String(el.textContent || "").trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function setLog(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function renderCart() {
    const n = num($("viz-cart-n"));
    const shelf = $("viz-cart-shelf");
    if (!shelf) return;
    shelf.innerHTML = "";
    const count = Math.max(0, Math.min(n, 12));
    for (let i = 0; i < count; i++) {
      const box = document.createElement("div");
      box.className = "viz-item";
      box.textContent = "■";
      shelf.appendChild(box);
    }
    if (count === 0) {
      shelf.innerHTML = '<span class="viz-empty-inline">empty</span>';
    }
    setLog("viz-cart-log", "cart=" + n + " · DOM text patch");
  }

  function flashDag() {
    const dag = $("viz-dag");
    if (!dag) return;
    ["cart", "total", "points"].forEach((k, i) => {
      const node = dag.querySelector('[data-k="' + k + '"]');
      if (!node) return;
      setTimeout(() => {
        node.classList.remove("flash");
        void node.offsetWidth;
        node.classList.add("flash");
      }, i * 100);
    });
    setLog(
      "viz-dag-log",
      num($("viz-dag-cart")) +
        " → " +
        num($("viz-dag-total")) +
        " → " +
        num($("viz-dag-points"))
    );
  }

  async function renderCatalog() {
    const n = num($("viz-catalog-n"));
    const box = $("viz-catalog");
    if (!box) return;
    if (n <= 0) {
      box.innerHTML = '<p class="viz-empty">Catalog → GET /api/catalog</p>';
      return;
    }
    try {
      const res = await fetch("/api/catalog");
      const data = await res.json();
      const items = data.items || [];
      box.innerHTML = "";
      const title = document.createElement("p");
      title.className = "viz-cat-title";
      title.textContent =
        "GET /api/catalog · " +
        items.length +
        " items · slot=" +
        n +
        " · " +
        (data.source || "server");
      box.appendChild(title);
      const grid = document.createElement("div");
      grid.className = "viz-cat-grid";
      items.forEach((p) => {
        const card = document.createElement("article");
        card.className = "viz-card";
        card.innerHTML =
          "<h4>" + p.name + "</h4><span>" + p.tag + " · $" + p.price + "</span>";
        grid.appendChild(card);
      });
      box.appendChild(grid);
      setLog("viz-effect-log", "db.get ok · catalog=" + n);
    } catch (e) {
      box.innerHTML = '<p class="viz-empty">/api/catalog failed</p>';
    }
  }

  function runTimeline() {
    const steps = document.querySelectorAll("#viz-timeline .viz-tl-step");
    steps.forEach((s) => s.classList.remove("on", "done"));
    let i = 0;
    function tick() {
      if (i > 0) steps[i - 1].classList.add("done");
      if (i < steps.length) {
        steps[i].classList.add("on");
        i++;
        setTimeout(tick, 200);
      }
    }
    tick();
  }

  function showPing() {
    const ms = num($("viz-ping-n"));
    const status = $("viz-ping-status");
    const wrap = $("viz-ping");
    if (wrap && ms > 0) {
      wrap.classList.remove("pulse");
      void wrap.offsetWidth;
      wrap.classList.add("pulse");
    }
    if (status) {
      status.textContent =
        ms > 0
          ? "RTT = " + ms + " ms · POST /api/effect (mode=rtt)"
          : "Ping: ещё не измеряли";
    }
    if (ms > 0) setLog("viz-effect-log", "pingMs=" + ms + " ms");
  }

  function fillSsr() {
    const root = document.getElementById("root");
    const el = $("viz-ssr");
    if (!el || !root) return;
    const ssr = root.getAttribute("data-aether-ssr") === "1";
    const nids = root.querySelectorAll("[data-aether-nid]").length;
    const snap = document.querySelector('script[type="aether/snapshot"]');
    el.textContent =
      "data-aether-ssr=" +
      (ssr ? "1" : "0") +
      "\nnid nodes=" +
      nids +
      "\nsnapshot=" +
      (snap ? "yes" : "no");
    setLog(
      "viz-ssr-log",
      ssr && nids > 0 ? "SSR hydrate ok" : "SSR missing — check server"
    );
  }

  async function fillRuntime() {
    const el = $("viz-runtime");
    if (!el) return;
    try {
      const p = await (await fetch("/aether.program.json")).json();
      const slots = (p.slots || []).length;
      const edges = (p.edges || []).length;
      const fe = (p.frontends || []).join(",") || "jsx";
      const gc = p.wasm_gc || p.wasmgc ? "WasmGC+linear" : "linear";
      el.textContent =
        "program · slots=" +
        slots +
        " · edges=" +
        edges +
        " · " +
        gc +
        " · frontend=" +
        fe;
      const ch = $("viz-dsm-ch");
      if (ch) ch.textContent = "DSM: WS /aether-dsm · HTTP /api/delta";
    } catch (e) {
      el.textContent = "program unavailable";
    }
  }

  function watch(el, fn) {
    if (!el) return;
    const mo = new MutationObserver(fn);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    fn();
  }

  function bind() {
    fillSsr();
    void fillRuntime();

    watch($("viz-cart-n"), () => {
      renderCart();
      flashDag();
      const sync = $("viz-sync-n");
      if (sync && $("viz-cart-n")) sync.textContent = $("viz-cart-n").textContent;
    });
    watch($("viz-dag-cart"), flashDag);
    watch($("viz-catalog-n"), () => {
      void renderCatalog();
    });
    watch($("viz-ping-n"), showPing);

    const catBtn = $("btn-catalog");
    if (catBtn) {
      catBtn.addEventListener("click", () => {
        setLog("viz-effect-log", "db.get…");
        runTimeline();
      });
    }
    const pingBtn = $("btn-ping");
    if (pingBtn) {
      pingBtn.addEventListener("click", () => {
        setLog("viz-effect-log", "ping RTT…");
        runTimeline();
      });
    }

    const orig = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const t0 = performance.now();
      const res = await orig.apply(this, arguments);
      const ms = Math.round(performance.now() - t0);
      if (url.indexOf("/api/delta") >= 0 || url.indexOf("/api/effect") >= 0) {
        try {
          const buf = await res.clone().arrayBuffer();
          const n = buf.byteLength;
          const mode = res.headers.get("X-Aether-Effect-Mode") || "";
          const reqLen =
            init && init.body
              ? init.body.byteLength || init.body.length || 0
              : 0;
          reportDsm(n, ms, reqLen, url);
          if (url.indexOf("/api/effect") >= 0 && mode.toLowerCase() === "rtt") {
            setTimeout(showPing, 50);
            setTimeout(showPing, 200);
          }
        } catch (e) {}
      }
      return res;
    };

    window.addEventListener("aether:dsm", (ev) => {
      const d = ev.detail || {};
      reportDsm(d.resBytes || 0, 0, d.reqBytes || 0, "/api/delta");
    });

    const syncBtn = $("btn-sync");
    if (syncBtn) {
      syncBtn.addEventListener("click", () => {
        setLog("viz-dsm-log", "sync…");
      });
    }
  }

  function reportDsm(resBytes, ms, reqBytes, url) {
    if (url.indexOf("/api/delta") < 0 && url.indexOf("delta") < 0) return;
    const bin = $("viz-pkt-bin");
    const json = $("viz-pkt-json");
    if (bin) {
      bin.classList.remove("idle");
      bin.classList.add("live");
      bin.textContent =
        "binary " +
        resBytes +
        " B" +
        (ms ? " · " + ms + " ms" : "") +
        (reqBytes ? " · req " + reqBytes + " B" : "");
    }
    if (json) {
      json.textContent = "JSON estimate ≈ " + Math.max(48, (reqBytes || 12) * 4) + " B";
    }
    setLog(
      "viz-dsm-log",
      "POST /api/delta → " +
        resBytes +
        " B" +
        (ms ? " · " + ms + " ms" : "") +
        (reqBytes ? " · req " + reqBytes + " B" : "")
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(bind, 80));
  } else {
    setTimeout(bind, 80);
  }
})();
