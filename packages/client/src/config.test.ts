import { test, expect } from "bun:test";
import { resolveServerUrl, DEFAULT_SERVER_URL, VERSION } from "./config";

test("compiled client version matches root release metadata", async () => {
  const manifest = await Bun.file(new URL("../../../package.json", import.meta.url)).json();
  expect(VERSION).toBe(manifest.version);
});

test("--server flag (space or =) wins over env and positional", () => {
  expect(resolveServerUrl(["--server", "ws://a"], { SERVER_URL: "ws://b" })).toBe("ws://a");
  expect(resolveServerUrl(["--server=ws://a"], { SERVER_URL: "ws://b" })).toBe("ws://a");
});

test("SERVER_URL env beats TERMENOR_SERVER, positional, and the default", () => {
  expect(resolveServerUrl(["ws://pos"], { SERVER_URL: "ws://env", TERMENOR_SERVER: "ws://t" })).toBe("ws://env");
});

test("TERMENOR_SERVER is used when SERVER_URL is absent", () => {
  expect(resolveServerUrl([], { TERMENOR_SERVER: "ws://t" })).toBe("ws://t");
});

test("a positional URL is used when no flag or env is present", () => {
  expect(resolveServerUrl(["ws://pos"], {})).toBe("ws://pos");
});

test("falls back to the canonical hosted endpoint with no args or environment", () => {
  expect(DEFAULT_SERVER_URL).toBe("wss://termenor.dkta.dev");
  expect(resolveServerUrl([], {})).toBe("wss://termenor.dkta.dev");
});

test("dashed flags are never mistaken for a positional URL", () => {
  expect(resolveServerUrl(["--debug"], {})).toBe(DEFAULT_SERVER_URL);
});
