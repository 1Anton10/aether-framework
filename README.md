# Aether

**Wasm UI framework** — compile UI → IR → memory → DOM patches → binary DSM.

[![CI](https://github.com/aether-js/aether-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/aether-js/aether-framework/actions/workflows/ci.yml)

> **Status: v0.1.0 alpha** — core pipeline works; not a drop-in Next/Nuxt replacement yet.

## Why Aether

| Classic SPA | Aether |
|-------------|--------|
| Virtual DOM reconcile | Wasm memory + dirty DAG |
| JSON hydration | Binary snapshot resume |
| JSON-RPC sync | Binary DSM deltas |
| One framework lock-in | Many syntaxes → one IR |

## Quick start

```bash
git clone <this-repo> aether-framework
cd aether-framework
cargo build -p aether_compiler
npm install
npm run build -w aether_runtime

npm run create -- my-app
cd my-app
npm run dev
```

| URL | |
|-----|--|
| http://localhost:5173 | app docs |
| http://localhost:5173/app | live UI |

Framework docs (from repo root `npm run dev`): http://localhost:3000

## Developer pipeline

```
JSX / Vue / Svelte / Angular / Solid / Qwik / Lit / HTML
        │
        ▼
 aether-compile → IR → app.wasm (+ app.gc.wasm)
        │
        ▼
 snapshot → mount once → dirty patches → DSM sync
```

## CLI

| Command | |
|---------|--|
| `create <name>` | scaffold (`create-aether`) |
| `dev` / `start` | HMR + SSR + DSM |
| `build` / `deploy` | production |
| `migrate` | Next/Nuxt/Vite/… → config + `src/pages` |

## Pages · Loaders · SSR

```
src/pages/index.tsx        → /
src/pages/about.tsx        → /about
src/pages/about.loader.ts  → server data hook
```

SSR: IR → HTML with `data-aether-nid`, client hydrates without wiping the tree.

Vite: `import aether from 'vite-plugin-aether'` → virtual `aether:program`.

## License

MIT — see `LICENSE`
