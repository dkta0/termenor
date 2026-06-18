# Core Architecture

## Entry Point / Layout
Termenor is a terminal-rendered multiplayer online (MMO) game structured as a monorepo:
- `packages/server` — Authoritative game server, managing state and systems.
- `packages/client` — Terminal graphics client using OpenTUI for rendering.
- `packages/protocol` — Message schemas, serialization, and shared wire formats.

## Key Invariants
- **Authoritative Server**: All player actions must be validated and executed server-side.
- **Database**: Game data persists in `./data/termenor.db` using `bun:sqlite`.
- **Headless Testing**: Smoke tests simulate pseudo-terminals (PTYs) to inspect raw terminal escape sequences for visual validation.

## Domain Directory
- For conventions, see `mem:conventions`.
- For building and testing commands, see `mem:suggested_commands`.
- To verify a completed task, see `mem:task_completion`.
