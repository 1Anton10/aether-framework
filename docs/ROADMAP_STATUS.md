# Roadmap vs manifesto — status (v1.0)

**Claim:** Aether v1.0 is the industrial **Frontend Runtime Standard** — one IR, one memory, one binary wire for the frontend world. Hand to testers via [`TRY.md`](./TRY.md).

## Four pillars

| Pillar | Manifesto | v1.0 |
|--------|-----------|------|
| Wasm + snapshots | Instant resume | **Shipped** (snapshot + nid SSR; WasmGC optional) |
| Dirty DAG | O(dirty) | **Shipped** + `npm run bench:public` / CI artifact |
| Algebraic effects | Sync-looking I/O | **Shipped** host perform/resume ([`EFFECTS.md`](./EFFECTS.md)); WasmFX later |
| DSM | Shared memory wire | **Shipped** HTTP/WS; WebTransport optional with TLS |

## Tester / industry path

- [x] `npm run setup` / `doctor` / `ensure:compiler`  
- [x] `docs/TRY.md` one-pager for external testers  
- [x] Release workflow: compiler binaries (win/mac/linux) + bench artifact  
- [x] Publish workflow: npm on tag (needs `NPM_TOKEN`)  
- [x] `create-aether` auto-clones framework if missing  

## Phase checklist

- [x] Phase 1–4a — IR, runtime, DSM, effects, migrate, store, Loop/Condition  
- [ ] Phase 4b — deep arbitrary npm React graph bridge  
- [ ] Phase 4c — Aether Cloud  
- [ ] External production adopters (outside this repo)  
