/**
 * One ledger: items, their activity, notes with their readings, and the record
 * of every radar event seen. Plain data plus small functions, so the same code
 * runs in the per-visitor demo sandboxes and in the tests.
 */
import type { ReaderOutput, Dropped } from "@/lib/reader/schema";
import type { EventRecord, Item, Update, Via } from "./types";

export type ReadingState =
  | { status: "ready"; output: ReaderOutput; dropped: Dropped[]; source: "fixture" | "claude" }
  | { status: "failed"; error: string };

/** What Apply changed, so one Undo can put every field back. */
export type AppliedChange = { itemId: string; before: Partial<Item>; versionAfter: number };

export type Note = {
  id: string;
  itemId: string;
  text: string;
  actor: string;
  via: Via;
  at: string;
  reading: ReadingState;
  /** The item's version when the note was read: Apply is refused if the item changed since. */
  readAtVersion: number;
  suggestion: "open" | "applied" | "dismissed";
  applied: AppliedChange[];
};

export type LedgerState = {
  items: Map<string, Item>;
  updates: Update[];
  notes: Note[];
  /** Every radar event id ever seen, with its answer: the idempotency record. */
  events: Map<string, EventRecord>;
  seq: number;
};

export const emptyState = (): LedgerState => ({ items: new Map(), updates: [], notes: [], events: new Map(), seq: 0 });

export function nextId(state: LedgerState, prefix: string): string {
  state.seq += 1;
  return `${prefix}_${state.seq.toString(36)}`;
}

export function addUpdate(state: LedgerState, itemId: string, text: string, by: { actor: string; via: Via }, at: string): void {
  state.updates.push({ id: nextId(state, "upd"), itemId, text, actor: by.actor, via: by.via, at });
}

/** Activity for one item, newest first. */
export const updatesFor = (state: LedgerState, itemId: string): Update[] =>
  state.updates.filter((u) => u.itemId === itemId).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

export const notesFor = (state: LedgerState, itemId: string): Note[] =>
  state.notes.filter((n) => n.itemId === itemId).sort((a, b) => (a.at < b.at ? 1 : -1));

/** Items newest purchase first. */
export const listItems = (state: LedgerState): Item[] =>
  [...state.items.values()].sort((a, b) => (a.boughtOn < b.boughtOn ? 1 : a.boughtOn > b.boughtOn ? -1 : a.id < b.id ? 1 : -1));
