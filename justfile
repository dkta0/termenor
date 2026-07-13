# termenor dev commands — run `just` to list recipes.
# Override any variable inline, e.g. `just port=3005 server`.

port := "3000"
user := "dev"
pass := "dev"

# list recipes
default:
    @just --list

# run the game server (PORT overridable: `just port=3005 server`)
server:
    PORT={{port}} bun run server

# run the client normally — shows the login screen (register or log in)
client:
    SERVER_URL=ws://localhost:{{port}} bun run client

# run the client with auto-login (dev account, bypasses the login screen) — for testing
client-dev:
    SERVER_URL=ws://localhost:{{port}} TERMENOR_USER={{user}} TERMENOR_PASS={{pass}} bun run client

# unit + integration tests
test:
    bun test

# typecheck all packages
typecheck:
    bun run typecheck

# install the pinned Python dependency for normalized terminal playtests
playtest-deps:
    PIP_BREAK_SYSTEM_PACKAGES=1 python3 -m pip install --user -r scripts/requirements-playtest.txt

# focused unit tests for PTY perception, waits, lifecycle, and artifacts
pty-harness-test:
    python3 -m unittest scripts/pty_harness_test.py

# real-terminal render smoke test (hermetic, own temp DB)
render:
    bun run verify:render

# real-terminal click-to-move smoke test (hermetic, own temp DB)
click:
    bun run verify:click

# real-terminal login → world smoke test (hermetic, own temp DB)
login:
    bun run verify:login

# deterministic headless tutorial Scenario
tutorial-headless:
    bun run verify:tutorial-headless

# full pre-commit gate: tests + typecheck + PTY harness + real-terminal checks
check: test typecheck pty-harness-test render click login

# free port 3000 by stopping the rivalmark web container that squats on it
free-port:
    -docker stop rivalmark-web-1
