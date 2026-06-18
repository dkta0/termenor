# Suggested Commands

## Development & Execution
- `just server` — Starts the authoritative server (default port 3000, override with `port=XXXX`).
- `just client` — Opens a real terminal client pointing to the server.
- `just client-dev` — Opens a client and skips the login screen (auto-registers/logs in).
- `scripts/demo.sh` — Launches a server and two clients side-by-side in tmux for co-location testing.

## Validation & Test Suite
- `just test` — Runs project unit and integration tests via `bun test`.
- `just typecheck` — Runs TypeScript static type checks via `tsc --noEmit`.
- `just render` — Tests headless rendering pipeline (`bun run verify:render`).
- `just click` — Tests mouse click inputs in pseudo-terminals (`bun run verify:click`).
- `just login` — Tests full PTY login flow (`bun run verify:login`).
- `just check` — Runs all of the above sequentially; the full pre-commit gate.
