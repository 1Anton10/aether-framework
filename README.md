# Aether

**Frontend Runtime Standard v1.0** — compile UI → IR → Wasm memory → dirty-DAG DOM patches → binary DSM.

[![CI](https://github.com/1Anton10/aether-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/1Anton10/aether-framework/actions/workflows/ci.yml)

> **Status: v1.0 — industrial Frontend Runtime Standard** ([`docs/ABI.md`](docs/ABI.md), [`docs/STANDARD.md`](docs/STANDARD.md)).  
> Russian: [`README.ru.md`](README.ru.md)

## Why the world needs a new stack

React, Vue, Angular, Svelte and their meta-frameworks optimized for **developer ecosystem velocity**. The cost is paid every frame and every sync: JS heap state, VDOM or large client bundles, JSON wires, hydrate-by-replaying.

Aether is the **runtime standard** underneath any syntax:

| | Legacy SPA stack | Aether 1.0 |
|--|------------------|------------|
| State | JS + Pinia/Redux/… | **Wasm slots** (+ `aether-std/store` Pinia-shaped API) |
| Updates | Full / broad reconcile | **Dirty DAG** |
| Boot | JS tree hydrate | **Binary snapshot** + nid |
| Sync | JSON | **Binary DSM** (12 B / i32) |
| Control flow | Framework-specific | **Loop + Condition** in IR |
| Syntax | One runtime locked in | **All major syntaxes → one IR** |

## Victory criteria (shipped)

1. One IR / one memory / one wire for the frontend world  
2. Real Live measure (not a formula) on the homepage  
3. Lists with per-row `$item`, conditions (`&&` / `v-if` / `{#if}` / `*ngIf`)  
4. Store API that writes Wasm (Pinia-shaped, not a second heap)  
5. Migrate detect: React, Preact, Next, Remix, Gatsby, Vue, Nuxt, Pinia, Weex, Angular, Analog, Svelte, SvelteKit, Elder, Solid, Qwik, Lit, Astro, Alpine  
6. Open ABI + CI gates  

Meta-framework **servers** are not embedded — that would reintroduce the slow path. Migrate + loaders + effects is the speed-safe way to absorb projects.

## Real metrics

`npm run bench` (this machine, representative):

| Bench | Result |
|-------|--------|
| Dirty DAG vs 50k edge scan | **~812×** faster |
| Binary DSM encode vs JSON (64 slots) | **~174×** faster, **~1.9×** fewer bytes |

Homepage **Live measure**: wall-clock DOM + payload + live `/api/delta` in *your* browser.

## Quick start (testers)

```bash
git clone https://github.com/1Anton10/aether-framework.git
cd aether-framework
npm install
npm run setup          # compiler + runtime + smoke + public bench
npm run start          # http://localhost:3000
npm run doctor         # environment check
```

Full tester guide: [`docs/TRY.md`](docs/TRY.md)

```bash
npm run create -- my-app
cd my-app && npm run dev
```

After the `v1.0.0` release is on npm:

```bash
npm create aether@latest my-app
```

Packages: `aether-std`, `aether_runtime`, `aether_ssr`, `aether_cli`, `create-aether`, `vite-plugin-aether`, `aether-compat-*`  
Repo: https://github.com/1Anton10/aether-framework

## Packages (1.0)

`aether-std` (`/store`, `/ssr`, `/router`) · `aether_runtime` · `aether_ssr` · `aether_cli` · `create-aether` · `vite-plugin-aether` · `aether-compat-*`  
(Note: bare `aether` on npm is an unrelated package — use **`aether-std`**.)

## License

MIT
