import { test, expect } from "bun:test";
import { isWorldClick, type HudRegions } from "./click-gate";

const base: HudRegions = { overlayOpen: false, panelCol: 58 };

test("an open overlay means no click is a world click", () => {
  const m = { ...base, overlayOpen: true };
  expect(isWorldClick(0, 0, m)).toBe(false);
  expect(isWorldClick(40, 12, m)).toBe(false);
});

test("clicks inside the side panel are not world clicks", () => {
  expect(isWorldClick(58, 3, base)).toBe(false); // left edge of panel
  expect(isWorldClick(70, 0, base)).toBe(false); // deep in panel
});

test("clicks left of the panel are world clicks", () => {
  expect(isWorldClick(57, 3, base)).toBe(true);
  expect(isWorldClick(0, 0, base)).toBe(true);
});
