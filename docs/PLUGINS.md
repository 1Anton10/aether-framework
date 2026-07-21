# Plugins & adapters

Aether ships first-party plugins. Community packages should follow the same contracts (`docs/ABI.md`).

## Official

| Package | Role |
|---------|------|
| `vite-plugin-aether` | Vite virtual `aether:program` |
| `create-aether` | App scaffold |
| `aether_cli` | dev / build / migrate / deploy |
| `aether-compat-react` | React JSX bridge |
| `aether-compat-vue` | Vue SFC bridge |
| `aether-compat-svelte` | Svelte bridge |
| `aether-compat-solid` | Solid |
| `aether-compat-qwik` | Qwik |
| `aether-compat-lit` | Lit |
| `aether-compat-angular` | Angular template |
| `aether-adapter` | Host adapter helpers |

## Plugin contract (0.3+)

1. Consume `aether.program.json` + Wasm exports from ABI  
2. Do not invent a second state store — write slots via `apply_delta` / handlers  
3. DSM: binary frames only (`/api/delta`, `/aether-dsm`)  
4. Effects: `POST /api/effect` with resume slot  

## Publish a community plugin

```bash
npm init
# name: aether-plugin-<name>
npm publish --access public
```

Link ABI + this doc in the README. Open a PR to list it under Community once CI green.
