const HISTORY_CAP = 50;

/** A typed command input buffer with history recall. Pure model, rendered as an overlay. */
export class CommandLine {
  input = "";
  active = false;
  private history: string[] = [];
  private cursor = 0; // index into history during recall; history.length == "fresh"

  open(): void {
    this.active = true;
    this.input = "";
    this.cursor = this.history.length;
  }

  cancel(): void {
    this.active = false;
    this.input = "";
  }

  /** Append a single printable char (ASCII 32–126). Ignores multi-char/control input. */
  type(ch: string): void {
    if (!this.active || ch.length !== 1) return;
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return;
    this.input += ch;
  }

  backspace(): void {
    if (!this.active) return;
    this.input = this.input.slice(0, -1);
  }

  /** Returns trimmed text (recorded in history) or null if blank. Deactivates. */
  submit(): string | null {
    if (!this.active) return null;
    const text = this.input.trim();
    this.active = false;
    this.input = "";
    if (text.length === 0) return null;
    this.history.push(text);
    if (this.history.length > HISTORY_CAP) this.history.shift();
    return text;
  }

  /** Recall older history into the input buffer. */
  historyPrev(): void {
    if (!this.active || this.history.length === 0) return;
    this.cursor = Math.max(0, this.cursor - 1);
    this.input = this.history[this.cursor] ?? "";
  }

  /** Walk back toward the freshest (empty) input. */
  historyNext(): void {
    if (!this.active || this.history.length === 0) return;
    this.cursor = Math.min(this.history.length, this.cursor + 1);
    this.input = this.cursor >= this.history.length ? "" : this.history[this.cursor];
  }
}
