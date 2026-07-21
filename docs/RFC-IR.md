# RFC: Aether IR v1

## Цель

Единый продукт компилятора — `AetherProgram`: плоская таблица узлов, таблица слотов, реактивные рёбра и эффекты. Не React-style VDOM как payload рантайма.

## Типы

| Тип | Роль |
|-----|------|
| `NodeId(u32)` | Стабильный индекс в `nodes` (порядок DFS от корня) |
| `SlotId(u32)` | Стабильный индекс в `slots` (имена отсортированы) |
| `Slot` | Именованная ячейка: `kind`, байтовый `offset` в линейной памяти |
| `ReactiveEdge` | Слот → цель DOM-патча (`SlotToText` / `SlotToAttr`) |
| `EffectOp` | Тело обработчика: `LocalInc` или `ServerMutate` |
| `AetherNode` | Описание для первичного mount |

## Стабильность

- ID узлов назначаются детерминированным DFS (`0` = корень).
- ID слотов — после лексикографической сортировки имён.
- Имена обработчиков берутся из JSX-идентификаторов (`localClick`, `server_increment`).

## Выход компилятора

1. `app.wasm` — линейная память + `apply_delta` + экспорты событий + импорты `env.dom_*`
2. `aether.program.json` — serde `AetherProgram` (граф mount + edges + slots)

Рантайм монтирует DOM один раз из program JSON, дальше патчит по рёбрам. VDOM для обновлений не перепарсивается.

## Вне скоупа Wave 1

Типы WasmGC, dirty-queue Adapton, алгебраический unwind стека, SFC-парсеры.
