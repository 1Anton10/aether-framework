export default function App() {
  return (
    <div className="ae-shell">
      <header className="ae-top">
        <a className="ae-brand" href="/">
          Aether
        </a>
        <span className="ae-badge">Live Playground</span>
        <a className="ae-link" href="/#compare">
          Compare
        </a>
        <a className="ae-link" href="/guide.html">
          Guide
        </a>
      </header>

      <section className="ae-hero">
        <p className="ae-eyebrow">Wasm memory · dirty DAG · binary DSM · SSR</p>
        <h1 className="ae-title">See what Aether does</h1>
        <p className="ae-lead">
          Это не toy-counter. Ниже — живые столпы архитектуры: derived-граф, server
          delta, algebraic effect, snapshot resume.
        </p>
      </section>

      <div className="ae-grid">
        <article className="ae-card ae-card-hero">
          <h2>1 · Local mutate</h2>
          <p className="ae-desc">Wasm handler пишет слот → точечный DOM patch</p>
          <p className="ae-metric">
            <span className="ae-metric-label">count</span>
            <span className="ae-metric-value">{count}</span>
          </p>
          <div className="ae-actions">
            <button onClick={inc_count}>+1 local</button>
            <button onClick={dec_count}>-1 local</button>
            <button onClick={reset_count}>reset</button>
          </div>
        </article>

        <article className="ae-card">
          <h2>2 · Derived DAG</h2>
          <p className="ae-desc">count → doubled → score без VDOM reconcile</p>
          <p className="ae-row">
            <span>doubled (×2)</span>
            <strong>{doubled}</strong>
          </p>
          <p className="ae-row">
            <span>score (×10)</span>
            <strong>{score}</strong>
          </p>
        </article>

        <article className="ae-card">
          <h2>3 · Binary DSM</h2>
          <p className="ae-desc">Server mutate — дельта по WS/HTTP, не JSON-RPC</p>
          <p className="ae-row">
            <span>synced count</span>
            <strong>{count}</strong>
          </p>
          <div className="ae-actions">
            <button onClick={server_inc_count}>+1 server</button>
          </div>
        </article>

        <article className="ae-card">
          <h2>4 · Algebraic effect</h2>
          <p className="ae-desc">perform db.get → suspend → resume в remote</p>
          <p className="ae-row">
            <span>remote</span>
            <strong>{remote}</strong>
          </p>
          <p className="ae-row">
            <span>latency_ms</span>
            <strong>{latency}</strong>
          </p>
          <div className="ae-actions">
            <button onClick={load_remote}>effect db.get</button>
            <button onClick={ping_effect}>effect ping</button>
          </div>
        </article>

        <article className="ae-card ae-card-wide">
          <h2>5 · Pipeline</h2>
          <p className="ae-desc">
            JSX → IR → app.wasm → snapshot in HTML → SSR hydrate → dirty patches → DSM
          </p>
          <div className="ae-chips">
            <span>SSR hydrate</span>
            <span>WasmGC + linear</span>
            <span>12B delta/slot</span>
            <span>no VDOM</span>
            <span>Vue/Solid/Angular → same IR</span>
          </div>
          <p className="ae-foot">
            Открой DevTools → Network: /api/delta и /api/effect — binary frames. Memory:
            script type=aether/snapshot.
          </p>
        </article>
      </div>
    </div>
  );
}
