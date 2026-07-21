# RFC: алгебраические эффекты

## Модель

`EffectOp::Perform` записывает continuation frame в линейную память и вызывает host-import `aether_suspend`. Host выполняет эффект (DSM), затем `aether_resume` / `apply_delta` (CPS re-entry).

```
perform → cont[suspended] → aether_suspend(id, slot, payload)
        → DSM /api/effect | WS 0xEF | WebTransport datagram
        → aether_resume(slot, value)  // = apply_delta
```

## Кадр запроса

```
effect_name_len : u16 LE
name            : utf-8
resume_slot     : u32 LE
payload         : i32 LE
```

## Unwind

Нативный Wasm stack unwind / WasmFX ещё не везде в браузерах. Aether использует **continuation frame + host resume** (та же раскладка, что нужна для WasmFX). Это не OS-thread block.
