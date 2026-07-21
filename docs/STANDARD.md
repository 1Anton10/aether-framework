# Frontend Runtime Standard v1.0

**Aether is the Frontend Runtime Standard** — one open contract for UI → IR → Wasm memory → dirty-DAG patches → binary DSM → effects → multi-syntax migrate. Normative: [`ABI.md`](./ABI.md).

## Reference — complete

- [x] Runtime: memory / DAG / DSM / effects / SSR nid  
- [x] Live `/demo` + Live measure bench  
- [x] CLI create / dev / build / migrate (React…Astro ecosystem detect)  
- [x] Vite plugin + compat (React, Vue+Pinia API, Svelte stores, Solid, Qwik, Lit, Angular)  
- [x] Syntax matrix (`npm run smoke:syntax`)  
- [x] `ControlFlow::Loop` + per-row `$item` + SSR/hydrate  
- [x] `ControlFlow::Condition` (`&&` / `v-if` / `{#if}` / `*ngIf`)  
- [x] `aether/store` — Pinia-shaped API → Wasm slots  
- [x] ABI freeze + CSP (`wasm-unsafe-eval`)  
- [x] `publish:check` + Playwright CI + tag publish  

**Claim:** Aether **v1.0** is the industrial **Frontend Runtime Standard** reference — the stack for compiling and running UI across the frontend world on one IR and one memory model.

**How it covers every ecosystem without shipping every legacy runtime:** syntax + migrate + compat APIs lower to Aether IR; meta-framework *servers* are not embedded (that would destroy the speed contract). The standard is the **runtime and wire**, not a polyfill of Next.js.

## Ship to testers / registry

1. Testers: [`TRY.md`](./TRY.md) — `git clone` → `npm run setup` → `npm run start`  
2. npm: tag `v1.0.0` → Publish + Release workflows (`NPM_TOKEN` configured)  
3. After release: `npm create aether@latest` · `npm run ensure:compiler` pulls binaries from GitHub Releases  
