# Try Aether (testers)

Give this page to anyone who should stress-test the **Frontend Runtime Standard v1.0**.

## 5-minute path (from git)

```bash
git clone https://github.com/1Anton10/aether-framework.git
cd aether-framework
npm install
npm run setup          # compiler + runtime + smoke + public bench
npm run start          # http://localhost:3000
```

Open:

| URL | What to verify |
|-----|----------------|
| `/` | Live measure (real DOM + DSM) |
| `/demo` | cart, derived, binary sync, effects, SSR, Loop, Condition |
| `/guide.html` | syntax matrix + migrate |

## Scaffold your own app

```bash
npm run create -- my-app
cd my-app
npm run dev
```

Or with monorepo env:

```bash
set AETHER_HOME=C:\path\to\aether-framework   # Windows
export AETHER_HOME=/path/to/aether-framework  # Unix
npx create-aether my-app
```

## Compiler without hunting Rust

`npm run setup` / `npm run ensure:compiler`:

1. Uses existing `target/*/aether-compile` if present  
2. Else downloads GitHub Release asset into `~/.aether/bin` (after first tagged release)  
3. Else `cargo build -p aether_compiler --release`  

Override: `AETHER_COMPILE=/path/to/aether-compile`

## Public bench (share numbers)

```bash
npm run bench:public
# → site/bench-results.json  (also printed)
```

CI uploads the same JSON as an artifact on every green run.

## npm registry

Packages publish on tag `v1.0.0` (GitHub Actions + `NPM_TOKEN`).

```bash
npm create aether@latest my-app
# or: npm i aether aether_runtime create-aether
```

Testers can always use **git clone + `npm run setup`** — fully supported.

## Doctor

```bash
npm run doctor
```

Checks Node, compiler binary, runtime build, ports.

## What “works” for a tester

- Write UI in JSX / Vue / Svelte / Angular / Solid / Qwik / Lit  
- Bindings + state slots + effects  
- SSR hydrate, binary `/api/delta`, Loop + Condition  
- `aether/store` / Pinia-shaped API  

What is **out of scope** for v1.0 speed contract: embedding Next/Nuxt servers as-is. Use `npm run migrate` then loaders/effects.
