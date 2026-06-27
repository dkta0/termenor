// Pure content for the controls overlay ("?") and the first-run hint. Kept here
// so the copy is reviewable and testable without booting a terminal. This is the
// shallow onboarding layer; an NPC-guided tutorial comes later.

/** The one-line hint shown briefly on first connect, until the first click. */
export const FIRST_RUN_HINT =
  "Click to move · your inventory is on the right · press ? for help";

/** How long the first-run hint lingers if the player hasn't clicked yet (ms). */
export const FIRST_RUN_HINT_MS = 8000;

export const HELP_TITLE = "Controls — press ? or Esc to close";

/**
 * Body lines for the help overlay. Grouped by concern; the renderer centers the
 * block. Keep lines short — they sit inside a centered box over the world.
 */
export const HELP_LINES: readonly string[] = [
  "Move      click a tile, or arrow keys",
  "Act       click an enemy to fight, a tree/rock",
  "          to gather, an item to pick it up",
  "",
  "Panel     click the tabs: Inv · Skills · Gear · Quest",
  "          Tab key cycles them",
  "Items     click an inventory item, then an action",
  "          (Equip · Drop · Exm)",
  "Gear      click an equipped slot to remove it",
  "",
  "Commands  press / then type, e.g.",
  "            /mine copper until full",
  "            /talk cook   /shop   /bank",
  "          Enter opens chat",
  "",
  "Fast keys a attack · c gather · g pick up (nearest)",
];
