/**
 * A reading becomes a suggestion card: one line per change, ticked by default
 * unless the reader was unsure. Nothing is written until a person taps Apply,
 * and one Undo takes back the whole Apply.
 */
import { shortDate } from "./dates";
import { formatMoney, parseMoney } from "./money";
import { addUpdate, type LedgerState, type Note } from "./state";
import type { Item, Marketplace } from "./types";
import type { ReaderChange, ReaderField } from "@/lib/reader/schema";

const FIELD_KEYS: Record<ReaderField, keyof Item> = {
  arrived_on: "arrivedOn",
  posted_on: "postedOn",
  posted_where: "postedWhere",
  posted_price: "postedPriceCents",
  sold_on: "soldOn",
  sold_price: "soldPriceCents",
  payout: "payoutCents",
  size: "size",
  paid: "paidCents",
};

export type SuggestionLine = { index: number; text: string; evidence: string; ticked: boolean };

/** `Posted on eBay`, `Sold for $360`, `Arrived Today`: the line a person ticks. */
export function lineText(change: ReaderChange, today: string): string {
  const money = () => formatMoney(parseMoney(change.value) ?? 0);
  switch (change.field) {
    case "arrived_on":
      return `Arrived ${shortDate(change.value, today)}`;
    case "posted_on":
      return `Posted ${shortDate(change.value, today)}`;
    case "posted_where":
      return `Posted on ${change.value}`;
    case "posted_price":
      return `Posted at ${money()}`;
    case "sold_on":
      return `Sold ${shortDate(change.value, today)}`;
    case "sold_price":
      return `Sold for ${money()}`;
    case "payout":
      return `Payout ${money()}`;
    case "size":
      return `Size ${change.value}`;
    case "paid":
      return `Paid ${money()} all in`;
  }
}

export function suggestionLines(note: Note, today: string): SuggestionLine[] {
  if (note.reading.status !== "ready") return [];
  return note.reading.output.changes.map((change, index) => ({
    index,
    text: lineText(change, today),
    evidence: change.evidence,
    ticked: change.confidence !== "low",
  }));
}

function valueFor(change: ReaderChange): Item[keyof Item] {
  switch (change.field) {
    case "posted_price":
    case "sold_price":
    case "payout":
    case "paid":
      return parseMoney(change.value);
    case "posted_where":
      return change.value as Marketplace;
    default:
      return change.value;
  }
}

export type ApplyResult = { ok: true } | { ok: false; reason: string };

export function applySuggestion(state: LedgerState, noteId: string, indexes: number[], actor: string, now: string): ApplyResult {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note || note.reading.status !== "ready" || note.suggestion !== "open") return { ok: false, reason: "Nothing to apply." };
  const item = state.items.get(note.itemId);
  if (!item) return { ok: false, reason: "The item is gone." };
  if (item.version !== note.readAtVersion) return { ok: false, reason: "The item changed after this note was read. Read it again." };
  const chosen = note.reading.output.changes.filter((_, i) => indexes.includes(i));
  if (chosen.length === 0) return { ok: false, reason: "Tick at least one line." };

  const before: Partial<Item> = {};
  const target = item as Record<keyof Item, unknown>;
  for (const change of chosen) {
    const key = FIELD_KEYS[change.field];
    if (!(key in before)) (before as Record<string, unknown>)[key] = item[key];
    target[key] = valueFor(change);
    if (change.field === "paid") item.paidIsSticker = false;
  }
  if (chosen.some((c) => c.field === "paid") && !("paidIsSticker" in before)) before.paidIsSticker = true;
  item.version += 1;
  note.suggestion = "applied";
  note.applied = [{ itemId: item.id, before, versionAfter: item.version }];
  const today = now.slice(0, 10);
  addUpdate(state, item.id, `From a note: ${chosen.map((c) => lineText(c, today)).join(", ")}`, { actor, via: "app" }, now);
  return { ok: true };
}

export function undoApply(state: LedgerState, noteId: string, actor: string, now: string): ApplyResult {
  const note = state.notes.find((n) => n.id === noteId);
  const change = note?.applied[0];
  if (!note || note.suggestion !== "applied" || !change) return { ok: false, reason: "Nothing to undo." };
  const item = state.items.get(change.itemId);
  if (!item) return { ok: false, reason: "The item is gone." };
  if (item.version !== change.versionAfter) return { ok: false, reason: "The item changed after this Apply, so Undo would overwrite newer edits." };
  Object.assign(item, change.before);
  item.version += 1;
  note.suggestion = "open";
  note.applied = [];
  note.readAtVersion = item.version;
  addUpdate(state, item.id, "Undid the changes from a note", { actor, via: "app" }, now);
  return { ok: true };
}

export function dismissSuggestion(state: LedgerState, noteId: string): ApplyResult {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note || note.suggestion !== "open") return { ok: false, reason: "Nothing to dismiss." };
  note.suggestion = "dismissed";
  return { ok: true };
}
