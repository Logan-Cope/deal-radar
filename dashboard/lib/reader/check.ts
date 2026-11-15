/**
 * The code checks on a reading. The prompt asks for these rules in words; this
 * file enforces them, so a rule the model breaks never reaches a person:
 *
 * - the change names a candidate item
 * - the evidence is a quote from the note, not a paraphrase
 * - a money value appears in its own evidence ("sold 400" can back 400.00, never 425.00)
 * - a date is real, not after the note's day and not before the purchase
 * - a marketplace is one the ledger knows
 * - nothing equal to the current value, and one value per field per item
 *
 * Every dropped change keeps its reason, so the card can say what was held back.
 */
import { compareDates, isDateString } from "@/lib/ledger/dates";
import { moneyValue, parseMoney } from "@/lib/ledger/money";
import { MARKETPLACES, type Item } from "@/lib/ledger/types";
import { DATE_FIELDS, MONEY_FIELDS, type Dropped, type ReaderChange, type ReaderField, type ReaderOutput } from "./schema";

export type CheckInput = { today: string; text: string; candidates: Item[] };

/** Lowercase, straight quotes, single spaces: the form two quotes are compared in. */
export function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Every amount written in a piece of text, in cents: "$1,150", "425", "309.12". */
export function amountsIn(text: string): number[] {
  return [...text.matchAll(/\$?\d[\d,]*(?:\.\d{1,2})?/g)]
    .map((m) => parseMoney(m[0]))
    .filter((c): c is number => c !== null);
}

/** The item's current value for a field, in the reader's format, for the no-op check. */
export function currentValue(item: Item, field: ReaderField): string | null {
  const money = (c: number | null) => (c === null ? null : moneyValue(c));
  switch (field) {
    case "arrived_on":
      return item.arrivedOn;
    case "posted_on":
      return item.postedOn;
    case "posted_where":
      return item.postedWhere;
    case "posted_price":
      return money(item.postedPriceCents);
    case "sold_on":
      return item.soldOn;
    case "sold_price":
      return money(item.soldPriceCents);
    case "payout":
      return money(item.payoutCents);
    case "size":
      return item.size;
    case "paid":
      return item.paidIsSticker ? null : money(item.paidCents);
  }
}

/** The canonical value, or why the value cannot stand. */
function canonical(change: ReaderChange, item: Item, input: CheckInput): { value: string } | { reason: string } {
  const value = change.value.trim();
  if (DATE_FIELDS.includes(change.field)) {
    if (!isDateString(value)) return { reason: "not a real date" };
    if (compareDates(value, input.today) > 0) return { reason: "a date after the note was written" };
    if (compareDates(value, item.boughtOn) < 0) return { reason: "a date before the item was bought" };
    return { value };
  }
  if (MONEY_FIELDS.includes(change.field)) {
    const cents = parseMoney(value);
    if (cents === null) return { reason: "not an amount" };
    if (!amountsIn(change.evidence).includes(cents)) return { reason: "the amount is not in its evidence" };
    return { value: moneyValue(cents) };
  }
  if (change.field === "posted_where") {
    const where = MARKETPLACES.find((m) => m.toLowerCase() === value.toLowerCase());
    return where ? { value: where } : { reason: "not a marketplace the ledger tracks" };
  }
  if (!value || value.length > 12) return { reason: "not a size" };
  return { value };
}

export function checkReading(raw: ReaderOutput, input: CheckInput): { output: ReaderOutput; dropped: Dropped[] } {
  const note = normalizeQuote(input.text);
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const kept: ReaderChange[] = [];
  const dropped: Dropped[] = [];
  const seen = new Set<string>();

  for (const change of raw.changes) {
    const drop = (reason: string) => dropped.push({ change, reason });
    const item = byId.get(change.item_ref);
    if (!item) {
      drop("not one of the candidate items");
      continue;
    }
    const quote = normalizeQuote(change.evidence);
    if (!quote || !note.includes(quote)) {
      drop("the evidence is not a quote from the note");
      continue;
    }
    const result = canonical(change, item, input);
    if ("reason" in result) {
      drop(result.reason);
      continue;
    }
    if (currentValue(item, change.field) === result.value) {
      drop("already the current value");
      continue;
    }
    const key = `${item.id}:${change.field}`;
    if (seen.has(key)) {
      drop("a second value for the same field");
      continue;
    }
    seen.add(key);
    kept.push({ ...change, value: result.value });
  }

  const itemRef = byId.has(raw.item_ref) ? raw.item_ref : "";
  return { output: { item_ref: itemRef, changes: kept, unclear: raw.unclear }, dropped };
}
