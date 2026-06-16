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

# run the client, auto-pointed at the local server on the same port
client:
    SERVER_URL=ws://localhost:{{port}} TERMENOR_USER={{user}} TERMENOR_PASS={{pass}} bun run client

# unit + integration tests
test:
    bun test

# typecheck all packages
typecheck:
    bun run typecheck

# real-terminal render smoke test (hermetic, own temp DB)
render:
    bun run verify:render

# real-terminal click-to-move smoke test (hermetic, own temp DB)
click:
    bun run verify:click

# full pre-commit gate: tests + typecheck + render + click
check: test typecheck render click

# free port 3000 by stopping the rivalmark web container that squats on it
free-port:
    -docker stop rivalmark-web-1
