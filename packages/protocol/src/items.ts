export interface ItemStack {
  item: string;
  qty: number;
}

export interface GroundItem {
  id: number;
  item: string;
  qty: number;
  x: number;
  y: number;
}

export const INV_SIZE = 28;

export interface ItemKind {
  name: string;
  glyph: string;
  color: [number, number, number];
  stackable: boolean;
}

export const ITEM_KINDS: Record<string, ItemKind> = {
  coins:        { name: "Coins",        glyph: "$", color: [255, 215,   0], stackable: true  },
  logs:         { name: "Logs",         glyph: "l", color: [139,  90,  43], stackable: true  },
  bronze_sword: { name: "Bronze sword", glyph: "/", color: [205, 127,  50], stackable: false },
  shrimp:       { name: "Shrimp",       glyph: "~", color: [255, 160, 122], stackable: true  },
  bronze_axe:      { name: "Bronze axe",      glyph: "T", color: [150, 110,  70], stackable: false },
  bronze_pickaxe:  { name: "Bronze pickaxe",  glyph: "P", color: [140, 110,  80], stackable: false },
  small_net:       { name: "Small net",        glyph: "n", color: [160, 160, 160], stackable: false },
  tinderbox:       { name: "Tinderbox",        glyph: "%", color: [180,  90,  40], stackable: false },
  copper_ore:      { name: "Copper ore",       glyph: "o", color: [180, 110,  70], stackable: true  },
  raw_shrimp:      { name: "Raw shrimp",       glyph: "r", color: [255, 150, 120], stackable: true  },
  cooked_shrimp:   { name: "Cooked shrimp",    glyph: "s", color: [255, 120,  90], stackable: true  },
  bronze_platebody:{ name: "Bronze platebody", glyph: "B", color: [205, 127,  50], stackable: false },
  bronze_shield:   { name: "Bronze shield",    glyph: ")", color: [180, 120,  60], stackable: false },
  // --- Smithing ---
  tin_ore:         { name: "Tin ore",          glyph: "o", color: [150, 150, 160], stackable: true  },
  iron_ore:        { name: "Iron ore",         glyph: "o", color: [120,  90,  80], stackable: true  },
  bronze_bar:      { name: "Bronze bar",        glyph: "=", color: [205, 127,  50], stackable: true  },
  iron_bar:        { name: "Iron bar",          glyph: "=", color: [180, 180, 185], stackable: true  },
  bronze_dagger:   { name: "Bronze dagger",     glyph: "!", color: [205, 127,  50], stackable: false },
  // --- Crafting ---
  cowhide:         { name: "Cowhide",           glyph: "h", color: [150, 110,  80], stackable: true  },
  leather:         { name: "Leather",           glyph: "L", color: [160, 120,  85], stackable: true  },
  leather_gloves:  { name: "Leather gloves",    glyph: "g", color: [165, 125,  90], stackable: false },
  // --- Fletching ---
  arrow_shafts:    { name: "Arrow shafts",      glyph: "|", color: [180, 150, 110], stackable: true  },
  feather:         { name: "Feather",           glyph: ",", color: [240, 240, 240], stackable: true  },
  bronze_arrow:    { name: "Bronze arrow",      glyph: ">", color: [205, 127,  50], stackable: true  },
  shortbow:        { name: "Shortbow",          glyph: "}", color: [160, 120,  70], stackable: false },
  // --- Herblore ---
  grimy_guam:      { name: "Grimy guam",        glyph: "\"", color: [ 80, 140,  70], stackable: true  },
  guam_leaf:       { name: "Guam leaf",         glyph: "\"", color: [110, 170,  90], stackable: true  },
  vial_of_water:   { name: "Vial of water",     glyph: "u", color: [150, 200, 230], stackable: true  },
  attack_potion:   { name: "Attack potion",     glyph: "i", color: [220,  80,  80], stackable: true  },
  // --- Runecrafting ---
  rune_essence:    { name: "Rune essence",      glyph: "*", color: [200, 200, 210], stackable: true  },
  air_rune:        { name: "Air rune",          glyph: "*", color: [180, 220, 255], stackable: true  },
  // --- Construction ---
  planks:          { name: "Planks",            glyph: "_", color: [170, 120,  70], stackable: true  },
  wooden_chair:    { name: "Wooden chair",      glyph: "n", color: [150, 110,  70], stackable: false },
  // --- Prayer / drops ---
  bones:           { name: "Bones",             glyph: "x", color: [230, 230, 210], stackable: true  },
  // --- Hunter / Farming / Cooking ---
  raw_bird_meat:   { name: "Raw bird meat",     glyph: "m", color: [200, 120,  90], stackable: true  },
  cooked_meat:     { name: "Cooked meat",       glyph: "M", color: [170, 100,  70], stackable: true  },
  potato_seed:     { name: "Potato seed",       glyph: ".", color: [180, 160,  90], stackable: true  },
  potato:          { name: "Potato",            glyph: "p", color: [200, 170, 110], stackable: true  },
};

export function isItem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ITEM_KINDS, id);
}
