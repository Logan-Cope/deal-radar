import { describe, expect, it } from "vitest";
import { applyRadarEvents, type RadarEventInput } from "@/lib/ledger/events";
import { addUpdate, emptyState, nextId } from "@/lib/ledger/state";

const NOW = "2026-11-15T12:00:00.000Z";

function bought(id: string, overrides: Partial<Extract<RadarEventInput, { type: "position.bought" }>> = {}): RadarEventInput {
  return {
    id,
    type: "position.bought",
    occurred_at: NOW,
    actor: { name: "Sam", via: "telegram" },
    alert_id: 7,
    position: { paid: 96, paid_is_sticker: true, bought_on: "2026-11-15" },
    item: { store: "Harbor & Pine", brand: "Orla Venn", title: "Tessel Field Boot", url: null, retail: 640 },
    comp: { verdict: "PASS", floor: 410, seller: "Northline Goods", ratio: 4.27, headroom: 240.24, matches: 3, brand_offers: 4, tier: "model" },
    ...overrides,
  } as RadarEventInput;
}

const removed = (id: string): RadarEventInput => ({ id, type: "position.removed", occurred_at: NOW, actor: { name: "Sam", via: "telegram" }, alert_id: 7 });

describe("applyRadarEvents", () => {
  it("creates the item from a buy, in cents, with its activity line", () => {
    const state = emptyState();
    expect(applyRadarEvents(state, [bought("tg:cb:1")], NOW)).toEqual([{ id: "tg:cb:1", status: "applied" }]);
    const [item] = [...state.items.values()];
    expect(item).toMatchObject({ paidCents: 9600, retailCents: 64000, paidIsSticker: true, radarAlertId: 7, version: 1 });
    expect(item?.comp?.floor).toBe(410);
    expect(state.updates[0]?.text).toBe("Bought for $96 at Harbor & Pine");
  });

  it("answers a repeated event id with duplicate and changes nothing", () => {
    const state = emptyState();
    applyRadarEvents(state, [bought("tg:cb:1")], NOW);
    expect(applyRadarEvents(state, [bought("tg:cb:1")], NOW)[0]?.status).toBe("duplicate");
    expect(state.items.size).toBe(1);
    expect(state.updates).toHaveLength(1);
  });

  it("fills only empty fields when the same alert is bought again under a new id", () => {
    const state = emptyState();
    applyRadarEvents(state, [bought("a", { item: { store: null, brand: "Orla Venn", title: "Tessel Field Boot", url: null, retail: null } })], NOW);
    const item = [...state.items.values()][0]!;
    item.brand = "Orla Venn (edited)";
    applyRadarEvents(state, [bought("b")], NOW);
    expect(item.brand).toBe("Orla Venn (edited)");
    expect(item.store).toBe("Harbor & Pine");
    expect(item.retailCents).toBe(64000);
    expect(state.items.size).toBe(1);
  });

  it("rejects a malformed event, records it, and says which field", () => {
    const state = emptyState();
    const bad = { ...bought("bad"), position: { paid: 0, paid_is_sticker: true, bought_on: "2026-11-15" } };
    const [result] = applyRadarEvents(state, [bad], NOW);
    expect(result?.status).toBe("rejected");
    expect(result?.error).toMatch(/^position\.paid/);
    expect(applyRadarEvents(state, [bad], NOW)[0]?.status).toBe("duplicate");
  });

  it("rejects an event with no usable id without recording it", () => {
    const state = emptyState();
    expect(applyRadarEvents(state, [{ type: "position.removed" }], NOW)[0]).toMatchObject({ id: null, status: "rejected" });
    expect(state.events.size).toBe(0);
  });

  it("treats a zero retail price as unknown", () => {
    const state = emptyState();
    applyRadarEvents(state, [bought("a", { item: { store: "S", brand: "B", title: "T", url: null, retail: 0 } })], NOW);
    expect([...state.items.values()][0]?.retailCents).toBeNull();
  });

  it("deletes the item on undo while only the radar has written to it", () => {
    const state = emptyState();
    applyRadarEvents(state, [bought("a")], NOW);
    expect(applyRadarEvents(state, [removed("u1")], NOW)[0]?.status).toBe("applied");
    expect(state.items.size).toBe(0);
    expect(state.updates).toHaveLength(0);
  });

  it("keeps the item and answers stale once a person has worked on it here", () => {
    const state = emptyState();
    applyRadarEvents(state, [bought("a")], NOW);
    const id = [...state.items.keys()][0]!;
    addUpdate(state, id, "Marked arrived", { actor: "Sam", via: "app" }, NOW);
    expect(applyRadarEvents(state, [removed("u1")], NOW)[0]?.status).toBe("stale");
    expect(state.items.has(id)).toBe(true);
  });

  it("adds a radar note to a known item and answers stale for an unknown alert", () => {
    const state = emptyState();
    applyRadarEvents(state, [bought("a")], NOW);
    const note = { id: "n1", type: "position.note", occurred_at: NOW, actor: { name: "Sam", via: "telegram" }, alert_id: 7, text: "got the 38" };
    expect(applyRadarEvents(state, [note], NOW)[0]?.status).toBe("applied");
    expect(state.notes[0]?.text).toBe("got the 38");
    expect(applyRadarEvents(state, [{ ...note, id: "n2", alert_id: 99 }], NOW)[0]?.status).toBe("stale");
  });

  it("applies a batch in order, so an undo after its buy in the same request works", () => {
    const state = emptyState();
    const results = applyRadarEvents(state, [bought("a"), removed("u")], NOW);
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(state.items.size).toBe(0);
    nextId(state, "x");
  });
});
