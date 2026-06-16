import { createCliRenderer, RGBA, type CliRenderer, type KeyEvent, type OptimizedBuffer } from "@opentui/core";
import { LoginForm } from "./login-form";
import { textCells } from "./overlay";
import type { AuthResult } from "../connection";

export interface LoginResult { mode: "login" | "register"; username: string; password: string; }

const BLACK = RGBA.fromInts(0, 0, 0, 255);
const WHITE = RGBA.fromInts(235, 235, 235, 255);
const DIM = RGBA.fromInts(120, 120, 120, 255);
const RED = RGBA.fromInts(230, 90, 90, 255);
const ACCENT = RGBA.fromInts(255, 210, 60, 255);

/**
 * Boots a minimal OpenTUI screen for login/register. Drives `attempt` on submit;
 * on failure it shows the reason and stays up for retry. Resolves with the
 * credentials that succeeded, after tearing the screen down. Requires a real terminal.
 *
 * Mirrors renderer.ts's real OpenTUI 0.4 surface: per-cell writes via `textCells` +
 * `buffer.setCell` (there is no `drawText`), `renderer.start()`/`renderer.destroy()`
 * for lifecycle, and `keyInput` with control keys on `name` / text on `sequence`.
 */
export async function runLogin(attempt: (p: LoginResult) => Promise<AuthResult>): Promise<LoginResult> {
  const renderer: CliRenderer = await createCliRenderer({ targetFps: 30, useMouse: false });
  const form = new LoginForm();
  let busy = false;

  return new Promise<LoginResult>((resolve) => {
    renderer.setFrameCallback(async () => {
      const buf: OptimizedBuffer | null = renderer.nextRenderBuffer;
      if (!buf) return;
      const cols = renderer.terminalWidth;
      const rows = renderer.terminalHeight;
      const v = form.view();
      buf.clear(BLACK);
      const cx = Math.floor(cols / 2);
      const top = Math.max(1, Math.floor(rows / 2) - 5);
      const line = (row: number, text: string, color = WHITE) => {
        const startCol = Math.max(0, cx - Math.floor(text.length / 2));
        for (const cell of textCells(text, startCol, row, cols, rows)) {
          buf.setCell(cell.col, cell.row, cell.char, color, BLACK);
        }
      };

      line(top, "T E R M E N O R", ACCENT);
      line(top + 1, "RuneScape in your terminal", DIM);
      const modeLabel = v.mode === "register"
        ? "( ) Log in    (•) Register   [Tab: switch field · ←/→: toggle]"
        : "(•) Log in    ( ) Register   [Tab: switch field · ←/→: toggle]";
      line(top + 3, modeLabel, DIM);
      line(top + 5, `${v.focus === "username" ? "›" : " "} Username  ${v.username || "_"}`,
        v.focus === "username" ? WHITE : DIM);
      line(top + 6, `${v.focus === "password" ? "›" : " "} Password  ${v.password || "_"}`,
        v.focus === "password" ? WHITE : DIM);
      if (v.error) line(top + 8, `⚠ ${v.error}`, RED);
      line(top + 10, busy ? "…connecting" : "Enter to play", busy ? DIM : ACCENT);
    });

    renderer.keyInput.on("keypress", async (key: KeyEvent) => {
      if (busy) return;
      const name = key.name ?? "";
      if (name === "tab") { form.focusNext(); return; }
      if (name === "left" || name === "right") { form.toggleMode(); return; }
      if (name === "backspace") { form.backspace(); return; }
      if (name === "return" || name === "enter") {
        if (!form.canSubmit()) { form.setError("enter a username and password"); return; }
        busy = true;
        const p = form.payload();
        const result = await attempt(p);
        if (result.ok) { renderer.destroy(); resolve(p); return; }
        form.setError(result.reason);
        busy = false;
        return;
      }
      // printable glyphs arrive via `sequence` (carries space, uppercase, etc.)
      const ch = key.sequence ?? "";
      if (ch.length === 1 && ch >= " " && ch !== "\x7f") form.type(ch);
    });

    renderer.start();
  });
}
