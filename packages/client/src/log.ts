export type LogTier = "ambient" | "notable" | "critical";
export interface LogEntry { tier: LogTier; text: string; }

const CAP = 200;

/** Append-only feedback log. Slice A: command confirmations/errors.
 *  Slice C: server-emitted events with meaningful tiers. */
export class LogState {
  private entries: LogEntry[] = [];

  push(tier: LogTier, text: string): void {
    this.entries.push({ tier, text });
    if (this.entries.length > CAP) this.entries.shift();
  }

  /** Last n entries, oldest-first. */
  recent(n: number): LogEntry[] {
    return this.entries.slice(-n);
  }
}
