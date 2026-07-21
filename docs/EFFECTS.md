# Effects for testers (v1.0)

## What ships today

Handlers with `"op": "perform"` suspend into the host:

1. Client writes continuation frame (ABI §5) and POSTs `/api/effect`
2. Host runs the effect (`rtt`, `catalog`, `toggle`, `add`, …)
3. Host returns binary deltas → `applyHostDelta` → dirty DAG patches

Demo: catalog load, ping RTT, condition toggle.

## WasmFX / stackful

The **memory layout** for a future stackful WasmFX path is frozen (`CONT_OFFSET`).  
v1.0 uses **host-assisted** resume (correct + fast). Full in-Wasm stack unwind is a later major when browsers/engines stabilize WasmFX.

## WebTransport

Optional HTTP/3 path when TLS env is set:

```bash
set AETHER_TLS_CERT=...
set AETHER_TLS_KEY=...
set AETHER_WT_PORT=4433
npm run start
```

Default tester path uses HTTP `/api/delta` + WS `/aether-dsm` — same binary codec.
