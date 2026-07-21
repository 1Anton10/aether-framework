# RFC: инкрементальные обновления (Wave 2)

## Цель

Обновлять DOM за **O(deps)**, а не O(|edges|) / O(|nodes|). При изменении слота X выполняются только рёбра из списка подписчиков `subscribers[X]`.

## Модель

```
Slot ──subscribers──► [edge_i, edge_j, …] ──► DOM patch
```

После `lower_program`:

1. Строится `edges: Vec<ReactiveEdge>`
2. `rebuild_subscribers()` заполняет `subscribers: Vec<Vec<u32>>` — для каждого `SlotId` индексы в `edges`

## Dirty queue (рантайм)

1. Мутация слота → `DirtyQueue.mark(slotId)`
2. В конце микрозадачи — `flush(slots)` только по отмеченным слотам
3. Для каждого слота патчатся только `subscribers[slot]`

Wasm-путь `apply_delta` уже разворачивает только subscribed edges (тот же список).

## Критерий

Изменение одного слота при 50k рёбрах других слотов не должно линейно сканировать все рёбра на стороне host fallback.
