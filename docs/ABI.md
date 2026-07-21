# Aether Runtime ABI — freeze v1.0

This document freezes the **public runtime contract** for Aether 1.0.x
(**Frontend Runtime Standard**). Breaking changes require a major bump and an RFC amendment.

Normative companions: `RFC-MEMORY.md`, `RFC-IR.md`, `RFC-DSM.md`, `RFC-EFFECTS.md`,
`schemas/bindings.schema.json` (also mirrored under `docs/` when present).

## 1. Identity

| Field | Value |
|-------|-------|
| Magic | `0x52485441` (`ATHR`) little-endian at memory offset 0 |
| Slot count | `u32` LE at offset 4 |
| Slot payload | packed from offset 8 |
| Cont frame | offset **192** (`CONT_OFFSET`) |
| DOM scratch | offset **256** |

## 2. Wasm exports (host must provide / call)

Required linear module exports:

| Export | Role |
|--------|------|
| `memory` | linear memory (mirror always present) |
| `aether_init` | initialize slots / GC array |
| `apply_delta` | apply binary delta into memory |
| handler names from bindings | e.g. `add_item`, `sync_cart` |

`aether_resume` may alias `apply_delta` in codegen.

Optional: `app.gc.wasm` (WasmGC). Host tries GC first; on failure loads linear `app.wasm`.

## 3. Snapshot wire format

- Client bootstrap: Base64 of the linear memory prefix (at least through slot payload + cont frame).
- Encoding tag in HTML: `<script type="aether/snapshot" data-encoding="base64">`.

## 4. Delta wire format

Binary frame, repeated records:

```
u32 slot_id LE
u32 byte_len LE
byte_len bytes  // new slot payload
```

Transport:

- HTTP `POST /api/delta`
- WebSocket `/aether-dsm` and `/api/dsm`
- Effects: `POST /api/effect` then host `resume` into `resume_slot`

## 5. Continuation frame (effects)

At offset 192:

| Offset | Field | Notes |
|--------|-------|-------|
| +0 | status | 0 ready, 1 suspended |
| +4 | effect_id | host lookup |
| +8 | resume_slot | slot written on resume |
| +12 | payload | host-defined |
| +16 | return_pc | reserved (WasmFX) |

## 6. DOM contract

- SSR emits `data-aether-nid` on nodes.
- Client hydrates by nid; does not wipe `#root` when `data-aether-ssr="1"`.
- Text bindings patch `textContent` for bound leaves.
- **Loop:** `ControlFlow::Loop(collection, item)` expands SSR clones and client `syncLoop` to the `i32` length of slot `collection`, capped at **64** (`LOOP_CAP`). Per-row text/attrs use `Expression("$item")` → 1-based index (packed payloads may extend without breaking this layout).
- **Condition:** `ControlFlow::Condition(slot)` mounts when slot ≠ 0.

## 7. Bindings JSON

Must validate against `schemas/bindings.schema.json` (draft-07).
Handler ops: `inc` | `dec` | `add` | `set` | `perform`.
Derived ops: `mul` | `add` | `copy` (case-insensitive aliases allowed).

## 8. Compatibility promise (1.0.x)

Guaranteed:

- Magic + layout offsets above
- Delta record shape
- Cont frame layout
- Snapshot base64 bootstrap
- nid hydration attribute name
- Loop length sync + `$item` row binding (SSR + hydrate + client)
- Condition show/hide by slot
- CSP requirement in §9

Ecosystem coverage (syntax → IR + migrate + compat), not embedding foreign servers:

- React / Preact / Next / Remix / Gatsby
- Vue / Nuxt / Pinia API / Weex
- Angular / Analog
- Svelte / SvelteKit / Elder
- Solid / Qwik / Lit / Astro / Alpine

## 9. CSP for Wasm hosts

Production pages that instantiate Wasm **must** allow:

```
script-src ... 'wasm-unsafe-eval'
```

Without it, `WebAssembly.instantiate` fails under modern CSP (Chrome).
