export interface ChatMessage { from: string; text: string; }

const CAP = 50;

export class ChatState {
  private messages: ChatMessage[] = [];
  input = "";
  active = false;

  open(): void {
    this.active = true;
    this.input = "";
  }

  cancel(): void {
    this.active = false;
    this.input = "";
  }

  /** Append a single printable character. Ignores multi-char strings and control codes. */
  type(ch: string): void {
    if (!this.active) return;
    if (ch.length !== 1) return;
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return;
    this.input += ch;
  }

  backspace(): void {
    if (!this.active) return;
    this.input = this.input.slice(0, -1);
  }

  /** Returns trimmed input text to send, or null if blank. Clears and deactivates. */
  submit(): string | null {
    if (!this.active) return null;
    const text = this.input.trim();
    this.active = false;
    this.input = "";
    return text.length > 0 ? text : null;
  }

  receive(from: string, text: string): void {
    this.messages.push({ from, text });
    if (this.messages.length > CAP) this.messages.shift();
  }

  /** Last n messages, oldest-first. */
  recent(n: number): ChatMessage[] {
    return this.messages.slice(-n);
  }
}
