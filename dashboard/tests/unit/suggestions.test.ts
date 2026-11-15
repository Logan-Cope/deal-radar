import { describe, expect, it } from "vitest";
import { seedState } from "@/lib/demo/seed";
import type { LedgerState, Note } from "@/lib/ledger/state";
import { applySuggestion, dismissSuggestion, suggestionLines, undoApply } from "@/lib/ledger/suggestions";
import { readNote } from "@/lib/reader/read";

const TODAY = "2026-11-15";
const NOW = `${TODAY}T12:00:00.000Z`;

async function noted(state: LedgerState, itemId: string, text: string): Promise<Note> {
  const item = state.items.get(itemId)!;
  const reading = await readNote({ today: TODAY, text, candidates: [item] });
  if (reading.status !== "ready") throw new Error(reading.error);
  const note: Note = {
    id: `note_${state.notes.length}`,
    itemId,
    text,
    actor: "You",
    via: "app",
    at: NOW,
    reading: { status: "ready", output: reading.output, dropped: reading.dropped, source: reading.source },
    readAtVersion: item.version,
    suggestion: "open",
    applied: [],
  };
  state.notes.push(note);
  return note;
}

describe("suggestions", () => {
  it("turns a reading into lines, ticked unless the reader was unsure", async () => {
    const state = seedState(TODAY);
    const note = await noted(state, "itm_tessel", "listed the tessel boots on ebay yesterday for 425");
    expect(suggestionLines(note, TODAY).map((l) => [l.text, l.ticked])).toEqual([
      ["Posted Yesterday", true],
      ["Posted on eBay", true],
      ["Posted at $425", true],
    ]);
  });

  it("applies only the ticked lines, and one undo restores every field", async () => {
    const state = seedState(TODAY);
    const item = state.items.get("itm_tessel")!;
    const note = await noted(state, item.id, "listed the tessel boots on ebay yesterday for 425");
    expect(applySuggestion(state, note.id, [0, 1, 2], "You", NOW)).toEqual({ ok: true });
    expect(item).toMatchObject({ postedOn: "2026-11-14", postedWhere: "eBay", postedPriceCents: 42500 });
    expect(undoApply(state, note.id, "You", NOW)).toEqual({ ok: true });
    expect(item).toMatchObject({ postedOn: null, postedWhere: null, postedPriceCents: null });
    // Apply, Undo, Apply again works.
    expect(applySuggestion(state, note.id, [2], "You", NOW)).toEqual({ ok: true });
    expect(item.postedPriceCents).toBe(42500);
    expect(item.postedWhere).toBeNull();
  });

  it("refuses an Apply when the item changed after the note was read", async () => {
    const state = seedState(TODAY);
    const note = await noted(state, "itm_halden", "trench came today! tag says M");
    state.items.get("itm_halden")!.version += 1;
    expect(applySuggestion(state, note.id, [0], "You", NOW)).toMatchObject({ ok: false });
  });

  it("refuses an Undo that would overwrite a newer edit", async () => {
    const state = seedState(TODAY);
    const note = await noted(state, "itm_halden", "trench came today! tag says M");
    applySuggestion(state, note.id, [0, 1], "You", NOW);
    state.items.get("itm_halden")!.version += 1;
    expect(undoApply(state, note.id, "You", NOW)).toMatchObject({ ok: false });
  });

  it("needs at least one ticked line, and a dismissed card cannot be applied", async () => {
    const state = seedState(TODAY);
    const note = await noted(state, "itm_halden", "trench came today! tag says M");
    expect(applySuggestion(state, note.id, [], "You", NOW)).toMatchObject({ ok: false });
    expect(dismissSuggestion(state, note.id)).toEqual({ ok: true });
    expect(applySuggestion(state, note.id, [0], "You", NOW)).toMatchObject({ ok: false });
  });

  it("writes the Apply to the activity as a person's edit", async () => {
    const state = seedState(TODAY);
    const note = await noted(state, "itm_halden", "trench came today! tag says M");
    applySuggestion(state, note.id, [0, 1], "You", NOW);
    expect(state.updates.at(-1)).toMatchObject({ text: "From a note: Arrived Today, Size M", via: "app" });
  });
});
