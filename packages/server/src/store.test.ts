import { test, expect, describe } from "bun:test";
import { SqliteStore, PostgresStore, createStore, type PlayerStore } from "./store";
import { emptyInventory } from "./inventory";
import { emptyEquipment } from "@termenor/protocol";

const SPAWN = { x: 24, y: 24, facing: "south" as const };

// Unique per process run so the persistent Postgres test DB doesn't collide across re-runs.
// (SQLite uses a fresh :memory: db per store, so the suffix is harmless there.)
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const u = (name: string) => `${name}_${RUN}`;

/**
 * One behaviour contract every PlayerStore must satisfy. Run against SQLite always; against
 * Postgres only when DATABASE_URL is set (so CI without a database still covers the contract).
 */
function conformance(name: string, make: () => PlayerStore) {
  describe(name, () => {
    test("login fails before an account exists; register creates it", async () => {
      const s = make();
      try {
        expect((await s.getOrCreateAccount(u("ann"), "pw", SPAWN, "login")).ok).toBe(false);
        expect((await s.getOrCreateAccount(u("ann"), "pw", SPAWN, "register")).ok).toBe(true);
        expect((await s.getOrCreateAccount(u("ann"), "pw", SPAWN, "register")).ok).toBe(false); // taken
      } finally { await s.close(); }
    });

    test("wrong password rejected, correct password accepted", async () => {
      const s = make();
      try {
        await s.getOrCreateAccount(u("bob"), "secret", SPAWN, "register");
        expect((await s.getOrCreateAccount(u("bob"), "nope", SPAWN, "login")).ok).toBe(false);
        expect((await s.getOrCreateAccount(u("bob"), "secret", SPAWN, "login")).ok).toBe(true);
      } finally { await s.close(); }
    });

    test("savePlayerState round-trips position, skills, inventory, bank, zone, and Scenario evidence", async () => {
      const s = make();
      try {
        await s.getOrCreateAccount(u("cara"), "pw", SPAWN, "register");
        const inv = emptyInventory(); inv[0] = { item: "logs", qty: 7 };
        const scenario = {
          scenarioId: "first_steps",
          version: 1,
          completed: ["meet_guide"],
          evidence: [{ objectiveId: "meet_guide", tick: 17 }],
          done: false,
        };
        await s.savePlayerState(u("cara"), {
          x: 5,
          y: 9,
          facing: "east",
          inventory: inv,
          skills: { mining: 100 },
          bank: [{ item: "coins", qty: 50 }],
          equipment: emptyEquipment(),
          zone: "cave",
          quests: { cooks_assistant: 2 },
          scenario,
        });
        const r = await s.getOrCreateAccount(u("cara"), "pw", SPAWN, "login");
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.state.x).toBe(5);
        expect(r.state.y).toBe(9);
        expect(r.state.facing).toBe("east");
        expect(r.state.zone).toBe("cave");
        expect(r.state.skills.mining).toBe(100);
        expect(r.state.inventory[0]).toEqual({ item: "logs", qty: 7 });
        expect(r.state.bank).toEqual([{ item: "coins", qty: 50 }]);
        expect(r.state.quests).toEqual({ cooks_assistant: 2 });
        expect(r.state.scenario).toEqual(scenario);
      } finally { await s.close(); }
    });
  });
}

conformance("SqliteStore", () => new SqliteStore(":memory:"));

if (process.env.DATABASE_URL) {
  conformance("PostgresStore", () => new PostgresStore(process.env.DATABASE_URL!));
} else {
  test.skip("PostgresStore conformance (set DATABASE_URL to run)", () => {});
}

test("createStore selects Postgres for a postgres:// URL and SQLite otherwise", () => {
  expect(createStore({ databaseUrl: "postgres://localhost/termenor" })).toBeInstanceOf(PostgresStore);
  // Empty databaseUrl forces the SQLite branch regardless of any ambient DATABASE_URL.
  expect(createStore({ databaseUrl: "", sqlitePath: ":memory:" })).toBeInstanceOf(SqliteStore);
});
