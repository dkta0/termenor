export interface ShopEntry { item: string; price: number; stock: number; }
export const SELL_RATE = 0.5; // sell price = floor(price * SELL_RATE)
export const BANK_CAP = 200;  // max distinct bank entries
export const SHOPS: Record<string, { name: string; entries: ShopEntry[] }> = {
  general_store: { name: "General Store", entries: [
    { item: "logs",          price: 4,  stock: 100 },
    { item: "raw_shrimp",    price: 3,  stock: 100 },
    { item: "bronze_axe",    price: 16, stock: 5 },
    { item: "bronze_pickaxe",price: 16, stock: 5 },
    { item: "tinderbox",     price: 8,  stock: 5 },
    { item: "small_net",     price: 8,  stock: 5 },
  ] },
};
