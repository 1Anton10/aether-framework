# Contributing

## Setup

```bash
cargo build -p aether_compiler
npm install
npm run build -w aether_runtime
npm run dev
```

## Tests

```bash
npm run test:ir
npm run test:compiler
npm run smoke
```

## PR checklist

- [ ] `cargo test -p aether_ir -p aether_compiler` passes
- [ ] `npm run smoke` passes
- [ ] No secrets (`.env`, keys) in the diff
- [ ] Update `CHANGELOG.md` for user-facing changes

## Architecture

See `docs/RFC-*.md`. Prefer IR + Wasm over phrase routers or hardcoded demo slots.
