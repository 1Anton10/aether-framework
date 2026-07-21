# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | yes |
| 0.3.x   | best-effort |
| 0.2.x   | best-effort |
| 0.1.x   | best-effort (alpha) |

## Reporting

Open a private security advisory on GitHub or email the maintainers. Do not file public issues for vulnerabilities until a fix is ready.

Do not commit `.env`, TLS keys, or tokens. CI rejects obvious secret paths via `.gitignore`.

## Production CSP

Hosts that load Aether Wasm must include `'wasm-unsafe-eval'` in `script-src` (see `docs/ABI.md` §9). Without it, `WebAssembly.instantiate` is blocked by the browser.
