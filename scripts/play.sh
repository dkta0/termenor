#!/usr/bin/env bash
# Termenor — one-command launcher. Connects you to the public server and plays.
#   ./play                  connect to the default public server
#   ./play ws://host:3000   connect to a specific server
set -euo pipefail

# Default public server. Updated to the live host when deployed (see Task 11).
DEFAULT_SERVER_URL="ws://localhost:3000"

# Resolve the real location of this script even when invoked via the ./play symlink
# (BASH_SOURCE reflects the invocation path, not the symlink target).
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
ROOT="$(cd -P "$(dirname "$SOURCE")/.." && pwd)"
cd "$ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo "Termenor needs Bun. Install it: https://bun.sh  (curl -fsSL https://bun.sh/install | bash)" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  bun install
fi

export SERVER_URL="${1:-${SERVER_URL:-$DEFAULT_SERVER_URL}}"
echo "Connecting to $SERVER_URL …  (use ghostty or kitty for best fidelity)"
exec bun run packages/client/src/index.ts
