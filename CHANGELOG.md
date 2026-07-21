## 0.1.0 — 2026-07-21

### Added
- IR → Wasm compiler (linear + WasmGC)
- Runtime: snapshot resume, dirty DAG, binary DSM, effects, SSR hydrate
- CLI: `create`, `dev`, `build`, `migrate`, `deploy`
- Frontends: JSX, Vue, Svelte, HTML, Angular, Solid, Qwik, Lit
- File-based `src/pages/*` + `*.loader.ts` + `pages.manifest.json`
- SSR: `aether_ssr` (`renderToString` / `renderToStream`) wired into app HTML
- `vite-plugin-aether` + meta package `aether`
- `create-aether` scaffold
- Client router (`AetherRouter`)
- Homepage live compare bench (Classic SPA vs Aether)
- Deep migrate: copy Next/Nuxt pages → `src/pages`
- Playwright e2e smoke (`npm run test:e2e`)
- GitHub Actions CI

### Notes
- Alpha: publishable architecture; Nest stays as API peer via DSM/effects
