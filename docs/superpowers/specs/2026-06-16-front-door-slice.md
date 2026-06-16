# Spec: Front Door (onboarding polish)

**Date:** 2026-06-16
**Branch:** `feat/front-door`
**Status:** ready to plan

## Background

Termenor has nine shipped slices (movement, iso renderer, accounts, chat, inventory,
NPCs, combat, woodcutting, skill framework) and is genuinely playable — but a stranger
who finds the repo cannot get into it. Today, playing requires running a server and a
client as two separate processes and supplying `TERMENOR_USER` / `TERMENOR_PASS` env
vars via `just` recipes (`justfile`, `client/src/index.ts:8`). The README still
describes slice 1 ("no combat, skilling, inventory, NPCs, or economy yet") and actively
misleads.

The goal of this slice is the **front door**: a newcomer runs one script, authenticates,
and is playing in a shared public world — **without reading a line of code**. This is a
polish slice promoted ahead of the feature roadmap; `feat/banking-shops` (slice 10,
Units 1–2 done) stays parked and is resumed after this lands.

Target experience, in the user's words: *"run a script, authenticate, then play."*
The world they land in is a **public shared server** the maintainer hosts (Docker on
VPS). Authentication is an **in-TUI login screen** with a real Login/Register
distinction.

Canonical domain language lives in [`CONTEXT.md`](../../../CONTEXT.md).

## Goals

1. **One-command launch.** A newcomer clones the repo and runs a single script that
   installs deps (if needed) and starts the client pointed at the public server. No env
   vars, no second process to start, no code to read.
2. **In-TUI login screen.** Before the world loads, the client shows a rendered
   login/register screen: Login/Register toggle, username + masked-password fields,
   inline error messages, and retry without restarting the process.
3. **Register vs login distinction on the wire.** The server distinguishes "create a new
   account" from "log into an existing one," with correct errors ("that name is taken",
   "no such account", "wrong password").
4. **Honest README.** Rewrite the README to reflect the current game and lead with the
   one-command "just play" path.
5. **Public deployment.** The server runs on the maintainer's VPS via the existing
   Docker compose setup, reachable at a stable URL the launch script defaults to.

## Non-goals

- **No new gameplay.** This slice changes onboarding and presentation only.
- **No anti-abuse hardening.** Rate-limiting registration, account caps, captcha, and
  griefing defenses are slice 16 (anti-cheat) territory. Basic existing validation
  (username length, non-empty password) is retained; nothing new is added here.
- **No TLS/DNS rabbit hole inside this spec.** Unit 5 ships plain `ws://` to a stable
  host (domain or IP). If `wss://` + DNS + certs is wanted, it becomes its own follow-up
  cycle rather than expanding this one.
- **No password-reset / account-management flows.** Out of scope.
- **No change to the game renderer.** The just-stabilized iso renderer is left untouched
  (see Unit 2 approach).

## Unit 1 — Register/login distinction (protocol + server)

1. **Protocol** (`packages/protocol/src/index.ts`): extend `LoginMsg` with a discriminator
   `mode: "login" | "register"`. Keep `t: "login"` as the message tag (the server's
   unauthenticated state already gates on it). `LoginErrorMsg` is unchanged (still
   `{ t: "loginError", reason }`) — the new reasons travel in `reason`.
2. **Server** (`packages/server/src/server.ts`, `db.ts`): split `getOrCreateAccount` into
   two paths driven by `mode`:
   - `register`: fail with `reason: "that name is taken"` if the account exists;
     otherwise create it and proceed.
   - `login`: fail with `reason: "no such account"` if it does not exist; verify the
     password and fail with `reason: "wrong password"` on mismatch; otherwise proceed.
   The existing TOCTOU reservation on `online` (`server.ts:71`) and the "already online"
   check are preserved.
3. **Tests**: `db.test.ts` / `server.test.ts` cover the four new branches (register-new,
   register-taken, login-missing, login-wrongpw) plus the existing already-online path.

## Unit 2 — In-TUI login screen + client flow inversion

**Approach: login as its own pre-game renderable (B).** The game renderer is not
modified. The client entrypoint runs a small, self-contained login renderable first;
once authentication succeeds it tears that down and starts the existing game renderer
unchanged.

1. **Flow inversion** (`packages/client/src/index.ts`): remove the pre-TUI stdin
   `readCredentials()` prompt. Start the login screen → on submit, drive a connection
   attempt with the chosen `{ mode, username, password }` → on `welcome`, resolve with the
   live connection + credentials → start the game renderer as today.
2. **Login screen unit** (new `packages/client/src/render/login.ts`): a focusable form
   rendered with OpenTUI — Login/Register toggle, username field, masked password field
   (display `•`, retain real value), a submit affordance, and an error line. On submit it
   invokes a caller-provided `attempt({mode, username, password})` callback and shows the
   returned error inline on failure, staying on-screen for retry.
3. **Connection** (`packages/client/src/connection.ts`): support an explicit auth attempt
   that resolves success vs failure (today only `onLoginError` exists). Add the success
   path (on `welcome`) so the login screen can transition. Auto-reconnect continues to
   reuse the captured credentials + mode.
4. **Risk: OpenTUI 0.4 raw-mode text input + password masking.** This is the least
   certain part. Prototype keystroke capture and masking against the real client first
   (see `opentui-0.4-gotchas` memory). If OpenTUI lacks a usable text-input primitive,
   implement minimal manual capture in `login.ts`.
5. **Tests**: unit-test the login screen's state machine (toggle, field editing, masking,
   error display, submit payload) headlessly, independent of the renderer. Extend the PTY
   render smoke (`scripts/pty-render-check.py`) so the gate exercises login → world.

## Unit 3 — One-command launch script

1. A single executable (e.g. `./play` or `scripts/play.sh`) that: checks for `bun`,
   runs `bun install` if needed, and launches the client pointed at the public server's
   URL by default. No env vars required.
2. The default server URL is a single source of truth the script and docs share; it is
   overridable (`./play ws://host:port` or `SERVER_URL=...`) for local/dev use.
3. `just` recipes remain for local dev (server + local client). The new script is the
   newcomer path, not a replacement for the dev workflow.

## Unit 4 — README rewrite

1. Replace the stale slice-1 description with an honest summary of the current game.
2. Lead with the one-command "just play" path (Unit 3). Keep the local-dev / contributor
   instructions (server + client via `just`) in a clearly separate section below.
3. Fix the rendering-tiers / architecture sections only where they are now inaccurate;
   do not gold-plate.

## Unit 5 — Public deployment

1. Deploy the server to the maintainer's VPS using the existing `Dockerfile` /
   `docker-compose.yml`, with the SQLite DB on a persistent Docker volume (matches the
   `persistence` slice).
2. Confirm the server is reachable at the stable URL the launch script defaults to, and
   that an account registered through the live client persists across a container
   restart.
3. Plain `ws://` for this slice (see non-goals). Flip the Unit 3 default URL to the live
   host once verified.

## Sequencing & done criteria

Build Units 1–4 against a **local** server (fully exercisable via `just check`), then do
Unit 5 last and flip the launch script's default URL. If Unit 5 grows TLS/DNS scope,
split it into its own cycle.

**Done when:** on a clean checkout, running the launch script connects to the public
server, an in-TUI login screen lets a new user register (and an existing user log in,
with correct errors for taken-name / missing-account / wrong-password), and the player
spawns into the shared world — with `just check` green and the README reflecting reality.
