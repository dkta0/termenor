# Tech Stack

## Language & Runtime
- **TypeScript**: Used uniformly across server, client, and protocol packages.
- **Bun**: Standard JS/TS runtime, package manager, and test runner.

## Infrastructure & Frame
- **OpenTUI**: Custom lightweight terminal UI library with multi-tier rendering.
- **WebSockets**: Live transport layer for server-client communication.
- **`bun:sqlite`**: Direct local SQLite access for database operations.

## Build / Task Management
- **Just**: Task runner with rules declared in `justfile`.
- **tsc**: TypeScript compiler used purely for static type verification (`tsc --noEmit`).
