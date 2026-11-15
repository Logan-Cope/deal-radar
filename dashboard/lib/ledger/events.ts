/**
 * The radar's events, applied to the ledger. Each event is applied once, in
 * order, and answered `applied`, `duplicate`, `stale` or `rejected`:
 *
 * - The event id is the idempotency key. Every id with a usable shape is
 *   recorded with its answer, so a retry after a timeout is `duplicate`.
 * - `position.bought` creates the item, or, when the alert is already in the
 *   ledger, fills only its empty fields. A repeat never overwrites a person's edit.
 * - `position.removed` (Undo on the phone) deletes the item only while nothing
 *   but the radar has written to it. Once someone has worked on it here, the
 *   undo is `stale` and the item stays.
 * - `position.note` adds a note to the item, for the reader.
 *
 * Dollars arrive as decimals and are stored as cents.
 */
import { z } from "zod";
import { isDateString } from "./dates";
import { formatMoney, MAX_CENTS } from "./money";
import { addUpdate, nextId, type LedgerState, type Note } from "./state";
import { RADAR_VIAS, type EventRecord, type EventStatus, type Item, type RadarComp } from "./types";

export const MAX_EVENT_ID_LENGTH = 200;
export const MAX_EVENTS_PER_REQUEST = 50;

const text = () => z.string().trim();
const optionalText = () =>
  z
    .string()
    .nullish()
    .transform((s) => s?.trim() || null);
const date = () => z.string().refine(isDateString, { error: "expected a YYYY-MM-DD date" });
const cents = () =>
  z
    .number()
    .nonnegative()
    .max(MAX_CENTS / 100)
    .transform((d) => Math.round(d * 100));
/** A price of zero is unknown (a store's compare-at of "0.00"), never a real price. */
const optionalPrice = () =>
  cents()
    .nullish()
    .transform((c) => c || null);

const actor = () => z.object({ name: text().min(1).max(64), via: z.enum(RADAR_VIAS) });
const base = {
  id: z.string().min(1).max(MAX_EVENT_ID_LENGTH),
  occurred_at: z.iso.datetime({ offset: true }),
  actor: actor(),
  alert_id: z.number().int().positive(),
};

const compSchema = z.object({
  verdict: z.string().min(1),
  floor: z.number().nullable(),
  seller: z.string().nullable(),
  ratio: z.number().nullable(),
  headroom: z.number().nullable(),
  matches: z.number().int(),
  brand_offers: z.number().int(),
  tier: z.string().nullable(),
}) satisfies z.ZodType<RadarComp>;

const boughtSchema = z.object({
  ...base,
  type: z.literal("position.bought"),
  position: z.object({
    paid: cents().pipe(z.number().positive({ error: "expected an amount above zero" })),
    paid_is_sticker: z.boolean(),
    bought_on: date(),
    size: optionalText(),
  }),
  item: z.object({
    store: optionalText(),
    brand: optionalText(),
    title: text().min(1),
    url: optionalText(),
    retail: optionalPrice(),
  }),
  comp: compSchema.nullish(),
  notes: z.array(z.string()).optional(),
});

export const eventSchema = z.discriminatedUnion("type", [
  boughtSchema,
  z.object({ ...base, type: z.literal("position.removed") }),
  z.object({ ...base, type: z.literal("position.note"), text: text().min(1).max(4000) }),
]);

export type RadarEvent = z.output<typeof eventSchema>;
export type RadarEventInput = z.input<typeof eventSchema>;
export type RadarResult = { id: string | null; status: EventStatus; error?: string };

/** Applies `events` in order and answers each. `now` is an ISO instant, for the records. */
export function applyRadarEvents(state: LedgerState, events: readonly unknown[], now: string): RadarResult[] {
  return events.map((raw) => applyOne(state, raw, now));
}

function eventId(raw: unknown): string | null {
  const id = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.length > 0 && id.length <= MAX_EVENT_ID_LENGTH ? id : null;
}

function record(state: LedgerState, id: string, type: string, status: EventStatus, now: string, error?: string): RadarResult {
  const entry: EventRecord = { id, type, status, at: now, ...(error ? { error } : {}) };
  state.events.set(id, entry);
  return { id, status, ...(error ? { error } : {}) };
}

function applyOne(state: LedgerState, raw: unknown, now: string): RadarResult {
  const id = eventId(raw);
  if (!id) return { id: null, status: "rejected", error: `id: expected a string of 1 to ${MAX_EVENT_ID_LENGTH} characters` };
  if (state.events.has(id)) return { id, status: "duplicate" };
  const type = String((raw as { type?: unknown }).type ?? "unknown");
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return record(state, id, type, "rejected", now, `${issue?.path.join(".") || "event"}: ${issue?.message ?? "invalid"}`);
  }
  return record(state, id, type, apply(state, parsed.data), now);
}

const itemForAlert = (state: LedgerState, alertId: number): Item | undefined =>
  [...state.items.values()].find((i) => i.radarAlertId === alertId);

function apply(state: LedgerState, event: RadarEvent): EventStatus {
  const item = itemForAlert(state, event.alert_id);
  const by = { actor: event.actor.name, via: event.actor.via };
  switch (event.type) {
    case "position.bought":
      if (item) fillEmpty(item, event);
      else createFromRadar(state, event);
      return "applied";
    case "position.note":
      if (!item) return "stale";
      state.notes.push(radarNote(state, item.id, event.text, by, event.occurred_at));
      return "applied";
    case "position.removed":
      if (!item || touchedHere(state, item.id)) return "stale";
      state.items.delete(item.id);
      state.updates = state.updates.filter((u) => u.itemId !== item.id);
      state.notes = state.notes.filter((n) => n.itemId !== item.id);
      return "applied";
  }
}

/** True once anyone has written to the item here: an app update, or a note not from the radar. */
export function touchedHere(state: LedgerState, itemId: string): boolean {
  return (
    state.updates.some((u) => u.itemId === itemId && u.via === "app") ||
    state.notes.some((n) => n.itemId === itemId && n.via === "app")
  );
}

function radarNote(state: LedgerState, itemId: string, text: string, by: { actor: string; via: Note["via"] }, at: string): Note {
  return {
    id: nextId(state, "note"),
    itemId,
    text,
    ...by,
    at,
    reading: { status: "failed", error: "unread" },
    readAtVersion: 0,
    suggestion: "open",
    applied: [],
  };
}

type Bought = Extract<RadarEvent, { type: "position.bought" }>;

function snapshot(event: Bought): Omit<Item, "id" | "version"> {
  const { position: p, item } = event;
  return {
    radarAlertId: event.alert_id,
    brand: item.brand ?? "",
    name: item.title,
    size: p.size,
    store: item.store,
    productUrl: item.url,
    paidCents: p.paid,
    paidIsSticker: p.paid_is_sticker,
    retailCents: item.retail,
    boughtOn: p.bought_on,
    dueOn: null,
    arrivedOn: null,
    postedOn: null,
    postedWhere: null,
    postedPriceCents: null,
    soldOn: null,
    soldPriceCents: null,
    payoutCents: null,
    comp: event.comp ?? null,
  };
}

function createFromRadar(state: LedgerState, event: Bought): void {
  const id = nextId(state, "itm");
  const values = snapshot(event);
  state.items.set(id, { ...values, id, version: 1 });
  const by = { actor: event.actor.name, via: event.actor.via };
  const where = values.store ? ` at ${values.store}` : "";
  addUpdate(state, id, `Bought for ${formatMoney(values.paidCents)}${where}`, by, event.occurred_at);
  for (const text of (event.notes ?? []).map((n) => n.trim()).filter(Boolean)) {
    state.notes.push(radarNote(state, id, text, by, event.occurred_at));
  }
}

const FILLABLE = ["brand", "size", "store", "productUrl", "retailCents", "comp"] as const;
const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

/** A repeat of a buy the ledger already has fills empty fields only. */
function fillEmpty(item: Item, event: Bought): void {
  const values = snapshot(event);
  let changed = false;
  for (const key of FILLABLE) {
    if (isEmpty(item[key]) && !isEmpty(values[key])) {
      (item as Record<string, unknown>)[key] = values[key];
      changed = true;
    }
  }
  if (changed) item.version += 1;
}
