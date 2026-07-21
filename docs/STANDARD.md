# Path to Aether as an industry baseline

Aether is **not** “React with Wasm”. It is a different runtime contract:

1. UI compiles to a stable IR and Wasm memory layout  
2. Updates are dirty-DAG patches, not VDOM reconcile  
3. Sync is binary DSM, not JSON-RPC  
4. SSR hydrates by node id, not by replaying a JS tree  

## Version targets

| Version | Meaning |
|---------|---------|
| **0.2.x** (now) | Architecture + DX tour + pages/loaders/SSR/Vite/migrate |
| **0.3** | Stable public npm (`aether`, `create-aether`), Playwright CI green on Linux |
| **0.4** | Production streaming SSR, asset pipeline, typed bindings |
| **0.5** | File routes + loaders as first-class (parity with Nuxt pages DX) |
| **1.0** | Semver-stable runtime ABI, docs site, migration guides, security process |

## What “standard” requires (checklist)

- [x] Distinct runtime model (memory / DAG / DSM / effects)
- [x] Multi-syntax → one IR
- [x] Create / dev / build / migrate CLI
- [x] Explained live demo (`/demo`)
- [x] SSR hydrate + stream endpoint (`/api/ssr`)
- [x] Vite plugin + meta package
- [ ] Published npm packages with CI provenance
- [ ] Broad production case studies
- [ ] Ecosystem plugins / community adapters
- [ ] Long-term ABI + RFC freeze

Until 1.0, call Aether an **architectural baseline candidate**, not a finished industry standard.
