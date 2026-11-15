/**
 * The demo's starting ledger: five synthetic buys at different stages, dated
 * relative to today so the status lines always read naturally. Every brand,
 * store and price here is invented.
 */
import { addDays } from "@/lib/ledger/dates";
import { formatMoney } from "@/lib/ledger/money";
import { addUpdate, emptyState, type LedgerState } from "@/lib/ledger/state";
import type { Item } from "@/lib/ledger/types";

type SeedItem = Omit<Item, "version">;

export function seedItems(today: string): SeedItem[] {
  const d = (n: number) => addDays(today, n);
  const blank = { dueOn: null, arrivedOn: null, postedOn: null, postedWhere: null, postedPriceCents: null, soldOn: null, soldPriceCents: null, payoutCents: null };
  return [
    {
      ...blank,
      id: "itm_tessel",
      radarAlertId: 1,
      brand: "Orla Venn",
      name: "Tessel Field Boot",
      size: "38",
      store: "Harbor & Pine",
      productUrl: null,
      paidCents: 10840,
      paidIsSticker: false,
      retailCents: 64000,
      boughtOn: d(-12),
      dueOn: d(-6),
      arrivedOn: d(-5),
      comp: { verdict: "PASS", floor: 410, seller: "Northline Goods", ratio: 4.27, headroom: 240.24, matches: 3, brand_offers: 4, tier: "model" },
    },
    {
      ...blank,
      id: "itm_halden",
      radarAlertId: 3,
      brand: "Vantor",
      name: "Halden Trench Coat",
      size: null,
      store: "Atelier Nord",
      productUrl: null,
      paidCents: 3900,
      paidIsSticker: true,
      retailCents: null,
      boughtOn: d(-3),
      dueOn: d(2),
      comp: { verdict: "PASS", floor: 420, seller: "Northline Goods", ratio: 10.77, headroom: 305.88, matches: 3, brand_offers: 3, tier: "model" },
    },
    {
      ...blank,
      id: "itm_pell",
      radarAlertId: 4,
      brand: "Sato Field",
      name: "Pell Loafer",
      size: "38",
      store: "Lowtide Supply",
      productUrl: null,
      paidCents: 7800,
      paidIsSticker: false,
      retailCents: 38000,
      boughtOn: d(-24),
      arrivedOn: d(-17),
      postedOn: d(-9),
      postedWhere: "eBay",
      postedPriceCents: 39500,
      comp: { verdict: "PASS", floor: 395, seller: "Second Thread", ratio: 5.64, headroom: 245.28, matches: 2, brand_offers: 11, tier: "model" },
    },
    {
      ...blank,
      id: "itm_vesper",
      radarAlertId: null,
      brand: "Isolde Park",
      name: "Vesper Satin Midi Skirt",
      size: "38",
      store: "Atelier Nord",
      productUrl: null,
      paidCents: 9100,
      paidIsSticker: false,
      retailCents: 36500,
      boughtOn: d(-40),
      arrivedOn: d(-33),
      postedOn: d(-30),
      postedWhere: "Grailed",
      postedPriceCents: 32000,
      soldOn: d(-2),
      soldPriceCents: 31000,
      payoutCents: 26350,
      comp: null,
    },
    {
      ...blank,
      id: "itm_dune",
      radarAlertId: 5,
      brand: "Marlow Atelier",
      name: "Dune Ribbed Tank",
      size: "S",
      store: "Atelier Nord",
      productUrl: null,
      paidCents: 2400,
      paidIsSticker: true,
      retailCents: 12000,
      boughtOn: d(-19),
      dueOn: d(-7),
      comp: { verdict: "SCARCE", floor: null, seller: null, ratio: null, headroom: null, matches: 0, brand_offers: 12, tier: null },
    },
  ];
}

export function seedState(today: string): LedgerState {
  const state = emptyState();
  for (const item of seedItems(today)) {
    state.items.set(item.id, { ...item, version: 1 });
    const via = item.radarAlertId ? "telegram" : "app";
    addUpdate(state, item.id, `Bought for ${formatMoney(item.paidCents)} at ${item.store}`, { actor: "Sam", via }, `${item.boughtOn}T15:00:00.000Z`);
    if (item.arrivedOn) addUpdate(state, item.id, "Marked arrived", { actor: "Sam", via: "app" }, `${item.arrivedOn}T18:00:00.000Z`);
    if (item.postedOn) addUpdate(state, item.id, `Posted on ${item.postedWhere}`, { actor: "Sam", via: "app" }, `${item.postedOn}T19:00:00.000Z`);
    if (item.soldOn) addUpdate(state, item.id, "Marked sold", { actor: "Sam", via: "app" }, `${item.soldOn}T20:00:00.000Z`);
  }
  return state;
}
