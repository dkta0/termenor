/**
 * Where the client connects by default: the authoritative hosted server. Players who run
 * the published binary reach the live world with no arguments. Override for local dev with
 * `--server ws://localhost:3000`, the `TERMENOR_SERVER`/`SERVER_URL` env vars, or a positional
 * URL. Set `TERMENOR_DEFAULT_SERVER` at build/runtime to rebrand the hosted default.
 */
export const DEFAULT_SERVER_URL = process.env.TERMENOR_DEFAULT_SERVER ?? "wss://play.termenor.io";

export const VERSION = "0.1.0";

/**
 * Resolve the server URL from CLI args + env, in priority order:
 * `--server <url>` / `--server=<url>` → `SERVER_URL` → `TERMENOR_SERVER` → first positional arg
 * → the hosted default.
 */
export function resolveServerUrl(argv: string[], env: Record<string, string | undefined> = process.env): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server" && argv[i + 1]) return argv[i + 1];
    if (a.startsWith("--server=")) return a.slice("--server=".length);
  }
  if (env.SERVER_URL) return env.SERVER_URL;
  if (env.TERMENOR_SERVER) return env.TERMENOR_SERVER;
  const positional = argv.find((a) => !a.startsWith("-"));
  if (positional) return positional;
  return DEFAULT_SERVER_URL;
}

export const HELP_TEXT = `termenor — a terminal MMO-RPG

Usage: termenor [options] [server-url]

Options:
  --server <url>   Connect to this server (default: ${DEFAULT_SERVER_URL})
  --help, -h       Show this help
  --version, -v    Show version

Environment:
  TERMENOR_SERVER / SERVER_URL   Server URL (overridden by --server)
  TERMENOR_USER / TERMENOR_PASS  Auto-login credentials (skip the login screen)
`;
