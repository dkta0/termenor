import { test, expect } from "bun:test";
import { pickEntity, regionAt, type HitEntity, type Region } from "./hit";

const ents: HitEntity[] = [
  { id: "goblin1", kind: "npc", vx: 40, vy: 20 },
  { id: "tree1", kind: "resource", vx: 80, vy: 60 },
  { id: "5", kind: "ground", vx: 41, vy: 22 },
];

test("pickEntity returns the nearest entity within radius", () => {
  const hit = pickEntity(40, 20, ents, 6);
  expect(hit?.id).toBe("goblin1");
});

test("pickEntity prefers the closer of two nearby entities", () => {
  // (41,21) is closest to ground "5" at (41,22) over goblin at (40,20)
  const hit = pickEntity(41, 21, ents, 6);
  expect(hit?.id).toBe("5");
});

test("pickEntity returns null when the click is outside every radius", () => {
  expect(pickEntity(200, 200, ents, 6)).toBeNull();
});

test("regionAt matches a region only on its row within its column span", () => {
  const regions: Region<string>[] = [
    { row: 2, col0: 10, col1: 20, value: "a" },
    { row: 3, col0: 10, col1: 20, value: "b" },
  ];
  expect(regionAt(15, 2, regions)).toBe("a");
  expect(regionAt(20, 3, regions)).toBe("b");
  expect(regionAt(21, 2, regions)).toBeNull(); // past col1
  expect(regionAt(15, 4, regions)).toBeNull(); // wrong row
});
