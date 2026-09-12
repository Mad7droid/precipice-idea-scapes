# Precipice contributor guide

Precipice is a local-first visual workspace. The web app, optional macOS app,
publication service, and local MCP bridge live in this repository.

## Start here

- [README.md](README.md) explains the product and local setup.
- [docs/codebase-architecture.md](docs/codebase-architecture.md) describes the current system.
- [docs/security-and-local-data.md](docs/security-and-local-data.md) defines data boundaries.
- [docs/desktop.md](docs/desktop.md) covers the macOS target and Keychain boundary.
- [docs/publishing-runbook.md](docs/publishing-runbook.md) covers the hosted publication service.

## Architectural rules

- Route document changes through `applyAction` in `src/core/reducer.ts`; preserve undo and
  validation semantics.
- Keep persistence behind `ScapeRepository`. Browser and desktop libraries are separate local
  stores; library import creates new IDs and never overwrites existing work.
- Web API keys are tab-session data. Desktop API keys may use the macOS Keychain through the
  restricted Tauri commands. Never persist either in files, IndexedDB, or logs.
- Public publishing receives a bounded read-only projection, never a local library or API key.
- Keep the native bridge narrow. Remote content must not receive Tauri permissions.
- Treat exports, screenshots, fixtures, and documentation as potential disclosure paths.

## Working conventions

- Use TypeScript, absolute `@/` imports, Prettier defaults, and colocated Vitest tests.
- Preserve the design tokens in `src/design/tokens.css`; do not add ad hoc visual constants.
- Keep user-visible changes recorded in `CHANGELOG.md`.
- Do not commit `.env` files, private Scapes, `Precipice-library.json`, credentials, database
  copies, signing material, or build artifacts.

## Verification

Run the checks that match the change:

```sh
pnpm verify
pnpm test:mcp
pnpm desktop:build                 # desktop changes on macOS
cargo test --manifest-path src-tauri/Cargo.toml
```

Before changing deployment, publishing, or security behavior, update the relevant docs and
verify that `.github/workflows/` still exercises the intended path.
