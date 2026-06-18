import { test, expect } from "bun:test";
import { isHudClick, type HudRegions } from "./click-gate";

const base: HudRegions = {
  modalOpen: false, panelCol: 58, panelBottomRow: 6, skillsRows: 5, skillsWidth: 18,
};

test("an open modal swallows every click", () => {
  const m = { ...base, modalOpen: true };
  expect(isHudClick(0, 0, m)).toBe(true);
  expect(isHudClick(40, 12, m)).toBe(true);
});

test("clicks inside the inventory panel are HUD clicks", () => {
  expect(isHudClick(60, 3, base)).toBe(true);   // inside the right panel
  expect(isHudClick(58, 1, base)).toBe(true);   // header row, left edge of panel
});

test("clicks below the inventory panel fall through to the world", () => {
  expect(isHudClick(60, 7, base)).toBe(false);  // y past panelBottomRow
});

test("clicks inside the skills HUD are HUD clicks", () => {
  expect(isHudClick(1, 0, base)).toBe(true);
  expect(isHudClick(18, 4, base)).toBe(true);   // within width and rows
});

test("clicks in the open world fall through", () => {
  expect(isHudClick(30, 12, base)).toBe(false);
  expect(isHudClick(25, 0, base)).toBe(false);  // top row but right of skills HUD
});
