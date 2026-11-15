/** The ledger's records. Money is integer cents; dates are `YYYY-MM-DD`. */

export const MARKETPLACES = ["eBay", "Grailed", "Vestiaire"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** Where a write came from. The radar writes through telegram, cli or the demo phone; people write through app. */
export const RADAR_VIAS = ["telegram", "cli", "phone"] as const;
export type Via = (typeof RADAR_VIAS)[number] | "app";

/** What the radar's comp gate knew when the card was sent. */
export type RadarComp = {
  verdict: string;
  floor: number | null;
  seller: string | null;
  ratio: number | null;
  headroom: number | null;
  matches: number;
  brand_offers: number;
  tier: string | null;
};

export type Item = {
  id: string;
  radarAlertId: number | null;
  brand: string;
  name: string;
  size: string | null;
  store: string | null;
  productUrl: string | null;
  paidCents: number;
  /** True while Paid is the store's sticker price, before shipping and tax. */
  paidIsSticker: boolean;
  retailCents: number | null;
  boughtOn: string;
  dueOn: string | null;
  arrivedOn: string | null;
  postedOn: string | null;
  postedWhere: Marketplace | null;
  postedPriceCents: number | null;
  soldOn: string | null;
  soldPriceCents: number | null;
  payoutCents: number | null;
  comp: RadarComp | null;
  /** Bumped on every write, so an Apply built against an older version is refused. */
  version: number;
};

/** One line in an item's activity: who did what, through which channel. */
export type Update = { id: string; itemId: string; text: string; actor: string; via: Via; at: string };

export type EventStatus = "applied" | "duplicate" | "stale" | "rejected";
export type EventRecord = { id: string; type: string; status: EventStatus; error?: string; at: string };
