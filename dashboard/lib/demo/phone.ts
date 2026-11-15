/**
 * The demo's phone: radar cards waiting for a decision. In production these
 * arrive in a Telegram chat; here they arrive on screen, and a tap sends the
 * exact event the radar would send, through the same apply function the
 * /api/radar/events route uses.
 */
import type { RadarEventInput } from "@/lib/ledger/events";
import type { RadarComp } from "@/lib/ledger/types";

export type PhoneCard = {
  alertId: number;
  verdict: "BUY" | "WATCH";
  kind: string;
  brand: string;
  name: string;
  store: string;
  price: number;
  was: number | null;
  sizes: string[];
  why: string;
  comp: RadarComp;
};

export const PHONE_CARDS: PhoneCard[] = [
  {
    alertId: 101,
    verdict: "BUY",
    kind: "Price drop",
    brand: "Vantor",
    name: "Keel Pleated Trouser",
    store: "Harbor & Pine",
    price: 59,
    was: 295,
    sizes: ["26", "27"],
    why: "80% off",
    comp: { verdict: "PASS", floor: 280, seller: "Kestrel Resale", ratio: 4.75, headroom: 164.92, matches: 2, brand_offers: 5, tier: "model" },
  },
  {
    alertId: 102,
    verdict: "BUY",
    kind: "Restock",
    brand: "Sato Field",
    name: "Rowan Knit Cardigan",
    store: "Harbor & Pine",
    price: 85,
    was: 340,
    sizes: ["S", "M"],
    why: "75% off",
    comp: { verdict: "SCARCE", floor: null, seller: null, ratio: null, headroom: null, matches: 0, brand_offers: 9, tier: null },
  },
  {
    alertId: 103,
    verdict: "BUY",
    kind: "New find",
    brand: "Orla Venn",
    name: "Cass Ankle Boot",
    store: "Lowtide Supply",
    price: 118,
    was: 690,
    sizes: ["37", "39"],
    why: "Watchlist brand at 83% off",
    comp: { verdict: "PASS", floor: 455, seller: "Second Thread", ratio: 3.86, headroom: 257.12, matches: 3, brand_offers: 7, tier: "model" },
  },
];

/** The evidence line under a card: what the rest of the market charges. */
export function compLine(comp: RadarComp): string {
  if (comp.verdict === "PASS" && comp.floor != null && comp.ratio != null) {
    const n = `${comp.matches} comp${comp.matches === 1 ? "" : "s"}`;
    return `Cheapest found $${comp.floor.toLocaleString("en-US")} at ${comp.seller}, ${comp.ratio.toFixed(1)}x our price (${n})`;
  }
  if (comp.verdict === "SCARCE") return `Could not price it: ${comp.brand_offers} offers for the brand, none for this piece`;
  return `Comp ${comp.verdict.toLowerCase()}`;
}

/** The radar's `position.bought` for a tap on a card. */
export function boughtEvent(card: PhoneCard, eventId: string, actor: string, at: string): RadarEventInput {
  return {
    id: eventId,
    type: "position.bought",
    occurred_at: at,
    actor: { name: actor, via: "phone" },
    alert_id: card.alertId,
    position: { paid: card.price, paid_is_sticker: true, bought_on: at.slice(0, 10) },
    item: { store: card.store, brand: card.brand, title: card.name, url: null, retail: card.was },
    comp: card.comp,
  };
}

export function removedEvent(card: PhoneCard, eventId: string, actor: string, at: string): RadarEventInput {
  return { id: eventId, type: "position.removed", occurred_at: at, actor: { name: actor, via: "phone" }, alert_id: card.alertId };
}
