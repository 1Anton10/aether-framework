# RFC: линейная память + WasmGC

## Раскладка (linear mirror — всегда)

```
offset 0..3   : magic u32 LE = 0x52485441 ("ATHR")
offset 4..7   : slot_count u32 LE
offset 8..    : payload слотов подряд
offset 192..  : continuation frame (effects)
offset 256..  : scratch для DOM patches
```

## WasmGC (когда `wasmgc: true`)

Дополнительно эмитится `app.gc.wasm`:

- тип `array (mut i32)` — heap слотов
- global `(ref null array)` — таблица значений
- `apply_delta` пишет и в linear mirror, и в `array.set`
- `aether_init` делает `array.new_default(slot_count)`

Рантайм предпочитает `app.gc.wasm`; при ошибке инстанциации — fallback на `app.wasm`.

## Continuation frame (`CONT_OFFSET = 192`)

```
status      u32  (0=ready, 1=suspended)
effect_id   u32
resume_slot u32
payload     u32
return_pc   u32   (WasmFX-ready)
```

## Snapshot / Delta

Без изменений Wave 1: Base64 префикса linear memory; delta `[slot_id][len][bytes]…`.
