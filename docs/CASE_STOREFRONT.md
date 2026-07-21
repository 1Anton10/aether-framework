# Case study: storefront demo

Live path: `/demo` (entry `examples/basic`).

## Problem

Classic SPA cart: VDOM reconcile on every +/- , JSON sync, fetch+setState for catalog.

## Aether solution

| Need | Mechanism | Demo section |
|------|-----------|--------------|
| Cart quantity | Wasm slot + DOM text patch | §1 |
| Price / points | Dirty DAG derived | §2 |
| Multi-tab sync shape | Binary `POST /api/delta` | §3 |
| Catalog + latency | Effect resume + RTT | §4 |
| First paint | SSR + `data-aether-nid` | §5 |
| Dynamic list length | `ControlFlow::Loop` + slot sync | §6 |

## Measured locally

- Sync response: binary frame (typically tens of bytes), not a JSON document  
- Ping: wall-clock RTT around `/api/effect` written to `pingMs`  
- Catalog: server memory list via `GET /api/catalog` after `db.get`  

## Production next steps

1. Replace demo catalog with your DB in `config.effects` / custom host handler  
2. Bind auth session on DSM HTTP/WS  
3. Publish app with `aether build` + CDN for `app.wasm`  

This case study is the reference “why Aether” for v0.3.
