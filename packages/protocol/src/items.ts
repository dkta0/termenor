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

export const ITEMS: Record<string, { name: string; glyph: string; color: [number, number, number]; stackable: boolean }> = {
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
};

export function isItem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ITEMS, id);
}
