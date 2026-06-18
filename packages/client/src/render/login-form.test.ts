import { test, expect } from "bun:test";
import { LoginForm } from "./login-form";

test("defaults to register mode, username focused, empty fields", () => {
  const f = new LoginForm();
  const v = f.view();
  expect(v.mode).toBe("register");
  expect(v.focus).toBe("username");
  expect(v.username).toBe("");
  expect(v.password).toBe("");
  expect(v.error).toBeNull();
});

test("toggleMode switches register <-> login", () => {
  const f = new LoginForm();
  f.toggleMode();
  expect(f.view().mode).toBe("login");
  f.toggleMode();
  expect(f.view().mode).toBe("register");
});

test("type appends to the focused field; focusNext moves to password", () => {
  const f = new LoginForm();
  f.type("a"); f.type("b");
  expect(f.view().username).toBe("ab");
  f.focusNext();
  expect(f.view().focus).toBe("password");
  f.type("x");
  expect(f.view().password).toBe("•"); // view masks; raw value checked via payload()
  expect(f.payload().password).toBe("x");
  expect(f.view().username).toBe("ab");
});

test("password is masked in the view but kept raw in the payload", () => {
  const f = new LoginForm();
  f.focusNext();
  f.type("s"); f.type("e"); f.type("c");
  expect(f.view().password).toBe("•••");
  expect(f.payload().password).toBe("sec");
});

test("backspace removes the last char of the focused field", () => {
  const f = new LoginForm();
  f.type("a"); f.type("b"); f.backspace();
  expect(f.view().username).toBe("a");
  f.backspace(); f.backspace(); // underflow is safe
  expect(f.view().username).toBe("");
});

test("payload reflects current mode and raw credentials", () => {
  const f = new LoginForm();
  f.type("a"); f.type("l"); f.type("i");
  f.focusNext(); f.type("p"); f.type("w");
  f.toggleMode();
  expect(f.payload()).toEqual({ mode: "login", username: "ali", password: "pw" });
});

test("setError / clearError control the error line", () => {
  const f = new LoginForm();
  f.setError("that name is taken");
  expect(f.view().error).toBe("that name is taken");
  f.clearError();
  expect(f.view().error).toBeNull();
});

test("canSubmit requires both fields non-empty", () => {
  const f = new LoginForm();
  expect(f.canSubmit()).toBe(false);
  f.type("u");
  expect(f.canSubmit()).toBe(false);
  f.focusNext(); f.type("p");
  expect(f.canSubmit()).toBe(true);
});

test("setMode selects an explicit mode and is idempotent", () => {
  const f = new LoginForm();          // default mode is "register"
  f.setMode("login");
  expect(f.view().mode).toBe("login");
  f.setMode("login");                 // idempotent — no flip
  expect(f.view().mode).toBe("login");
  f.setMode("register");
  expect(f.view().mode).toBe("register");
});
