# Changelog

## 0.1.0 — 2026-07-21

### Added
- IR → Wasm compiler (linear + WasmGC)
- Runtime: snapshot resume, dirty DAG, binary DSM, effects
- CLI: `create`, `dev`, `build`, `migrate`, `deploy`
- Frontends: JSX, Vue, Svelte, HTML, Angular templates, Solid, Qwik, Lit
- Compat packages for React / Vue / Solid / Qwik / Lit / Angular
- Client router (`aether/router`)
- Docs site: Getting Started, Guide, API
- GitHub Actions CI (Rust tests + runtime build + smoke)

### Notes
- Alpha: production SSR / full Next-Nuxt drop-in not included
- NestJS is backend — use alongside Aether via DSM/effects, not as a UI host
