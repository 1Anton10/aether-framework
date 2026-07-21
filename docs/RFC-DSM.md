# RFC: DSM-транспорт

## Кодек

`[slot_id u32][len u32][payload…]…`. Effect: первый байт `0xEF` + кадр эффекта.

## Каналы (приоритет клиента)

| # | Транспорт | Путь |
|---|-----------|------|
| 1 | WebTransport (HTTP/3) | `https://host/aether-dsm` |
| 2 | WebSocket binary | `/aether-dsm` |
| 3 | WebSocket binary | `/api/dsm` |
| 4 | HTTP POST | `/api/delta`, `/api/effect` |

## HTTP/3 сервер

При `AETHER_TLS_CERT` + `AETHER_TLS_KEY` CLI поднимает HTTP/3 WebTransport
(`@fails-components/webtransport`, порт `AETHER_WT_PORT`, по умолчанию 4433).
Без TLS — WS/HTTP (тот же кодек).
