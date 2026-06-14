#!/usr/bin/env bash
# One-command local demo: starts the server and two clients side-by-side in tmux
# so you can watch two players walk around in real time. Run this inside ghostty
# or kitty for full half-block fidelity. Ctrl-b then & (or `tmux kill-session
# -t termenor`) to quit.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
SESSION="termenor"

command -v tmux >/dev/null || { echo "tmux required (or run server/client manually — see README)"; exit 1; }
command -v bun  >/dev/null || { echo "bun required"; exit 1; }

bun install >/dev/null 2>&1 || true

tmux kill-session -t "$SESSION" 2>/dev/null || true

# pane 0: server (top, full width)
tmux new-session -d -s "$SESSION" -x "$(tput cols)" -y "$(tput lines)" \
  "PORT=$PORT bun run server; read -p 'server stopped — enter to close'"
sleep 1.5
# pane 1: client A (bottom-left)
tmux split-window -v -t "$SESSION" \
  "sleep 0.6; SERVER_URL=ws://localhost:$PORT bun run client"
# pane 2: client B (bottom-right)
tmux split-window -h -t "$SESSION" \
  "sleep 0.9; SERVER_URL=ws://localhost:$PORT bun run client"
tmux select-layout -t "$SESSION" main-horizontal

echo "termenor demo running in tmux session '$SESSION'."
echo "Click a far tile (or use arrow keys) in either client pane; watch the other."
tmux attach -t "$SESSION"
