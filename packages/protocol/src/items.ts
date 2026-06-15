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
  bronze_axe:   { name: "Bronze axe",   glyph: "T", color: [150, 110,  70], stackable: false },
};

export function isItem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ITEMS, id);
}
