# Aether

**Frontend Runtime Standard v1.0** — UI → IR → память Wasm → dirty-DAG патчи → binary DSM.

[![CI](https://github.com/1Anton10/aether-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/1Anton10/aether-framework/actions/workflows/ci.yml)

> **v1.0 — промышленный стандарт рантайма фронтенда** ([`docs/STANDARD.md`](docs/STANDARD.md)).  
> English: [`README.md`](README.md)

## Зачем новый стек

Экосистемы React / Vue / Angular / Svelte выиграли DX. Цена — JS-куча, reconcile, JSON, тяжёлый hydrate.

Aether — **стандарт рантайма** под любой синтаксис: одна память, один IR, один бинарный провод.

| | Старый SPA | Aether 1.0 |
|--|------------|------------|
| Стейт | Pinia / Redux / … | **Wasm-слоты** + `aether/store` (API как у Pinia) |
| Обновления | широкий reconcile | **Dirty DAG** |
| Старт | hydrate JS | **Snapshot** + nid |
| Синк | JSON | **Binary DSM** |
| Списки / if | свой runtime | **Loop + Condition** в IR |
| Синтаксисы | один lock-in | **все мажорные → один IR** |

Серверы Nuxt/Next **не встраиваем** (это убило бы скорость). Absorb = migrate + loaders + effects.

## Победа (уже в репо)

- Live measure на главной  
- Loop + `$item`, Condition  
- Store → Wasm  
- Migrate по всей карте экосистем  
- ABI + CI  

Метрики: `npm run bench` · ~812× DAG · ~174× encode vs JSON.

## Быстрый старт (тестеры)

```bash
git clone https://github.com/1Anton10/aether-framework.git
cd aether-framework
npm install
npm run setup
npm run start
npm run doctor
```

Гид: [`docs/TRY.md`](docs/TRY.md)

После релиза на npm:

```bash
npm create aether@latest my-app
```

Репо: https://github.com/1Anton10/aether-framework

## Лицензия

MIT
