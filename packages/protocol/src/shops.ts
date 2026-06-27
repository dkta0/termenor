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
    { item: "bronze_sword",     price: 26, stock: 5 },
    { item: "bronze_platebody", price: 40, stock: 5 },
    { item: "bronze_shield",    price: 24, stock: 5 },
    // Raw materials so every skill is trainable from a fresh account.
    { item: "tin_ore",       price: 4,  stock: 100 },
    { item: "cowhide",       price: 6,  stock: 100 },
    { item: "feather",       price: 1,  stock: 500 },
    { item: "grimy_guam",    price: 5,  stock: 100 },
    { item: "vial_of_water", price: 2,  stock: 100 },
    { item: "rune_essence",  price: 3,  stock: 200 },
    { item: "bones",         price: 2,  stock: 100 },
    { item: "potato_seed",   price: 1,  stock: 100 },
  ] },
};
