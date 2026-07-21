# Changelog

## 1.0.0 — 2026-07-22

### Added
- **Frontend Runtime Standard v1.0** — industrial claim with ABI freeze
- `ControlFlow::Condition` (`&&`, `v-if`, `{#if}`, `*ngIf`) + SSR/hydrate
- Loop per-row `$item` binding (1-based index, O(dirty) clones)
- `aether/store` + Pinia-shaped Vue compat (`defineStore` → Wasm slots)
- Live measure bench (real DOM + JSON vs dirty + binary + live DSM)
- Migrate matrix: Remix, Gatsby, Analog, Elder, Astro, Alpine, Weex, Pinia aliases

### Changed
- Packages **1.0.0**; site/docs claim industrial standard without “soon” caveats on core contract

## 0.3.0 — 2026-07-22

### Added
- Wasm UI Runtime Standard v0.3 — Loop length sync, SSR expand, hydrate `loopRoots`
- Lists: JSX `.map`, Vue `v-for`, Svelte `{#each}`, Angular `*ngFor`, Solid `items().map`
- Compat publish path; `smoke:syntax` in CI

## 0.2.0 — 2026-07-21

### Added
- Live Tour `/demo`, loaders, publish metadata

## 0.1.0 — 2026-07-21

### Added
- IR → Wasm, runtime, CLI, multi-frontend parsers, SSR, CI
