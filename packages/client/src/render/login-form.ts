export type AuthMode = "login" | "register";
type Field = "username" | "password";

export interface LoginView {
  mode: AuthMode;
  focus: Field;
  username: string;
  password: string; // masked
  error: string | null;
}

/** Pure, render-agnostic state for the login/register screen.
 *  All terminal/OpenTUI wiring lives in login.ts; this is unit-tested in isolation. */
export class LoginForm {
  private mode: AuthMode = "register";
  private focus: Field = "username";
  private username = "";
  private password = "";
  private error: string | null = null;

  toggleMode(): void {
    this.mode = this.mode === "register" ? "login" : "register";
  }

  setMode(mode: AuthMode): void {
    this.mode = mode;
  }

  focusNext(): void {
    this.focus = this.focus === "username" ? "password" : "username";
  }

  type(ch: string): void {
    if (this.focus === "username") this.username += ch;
    else this.password += ch;
    this.error = null;
  }

  backspace(): void {
    if (this.focus === "username") this.username = this.username.slice(0, -1);
    else this.password = this.password.slice(0, -1);
    this.error = null;
  }

  setError(reason: string): void { this.error = reason; }
  clearError(): void { this.error = null; }

  canSubmit(): boolean {
    return this.username.length > 0 && this.password.length > 0;
  }

  payload(): { mode: AuthMode; username: string; password: string } {
    return { mode: this.mode, username: this.username, password: this.password };
  }

  view(): LoginView {
    return {
      mode: this.mode,
      focus: this.focus,
      username: this.username,
      password: "•".repeat(this.password.length),
      error: this.error,
    };
  }
}
