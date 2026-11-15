/**
 * Everything a person can do, as data. A server action turns a form into an
 * Action and applies it here; the demo also replays a visitor's saved actions
 * through this same function on every request (lib/demo/session.ts). Each
 * Action carries its own timestamp, so a replay rebuilds exactly the same ledger.
 */
import { z } from "zod";
import { nextId } from "@/lib/ledger/state";
import { applySuggestion, dismissSuggestion, undoApply } from "@/lib/ledger/suggestions";
import { readNote, type ReaderResult } from "@/lib/reader/read";
import { boughtEvent, PHONE_CARDS, removedEvent } from "./phone";
import { sendEvents, type Sandbox } from "./sandbox";

export const ACTOR = "You";
export const MAX_NOTE = 1000;

const at = z.number().int().nonnegative();
export const actionSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("tap"), card: z.number().int(), d: z.enum(["bought", "skipped"]), at }),
  z.object({ t: z.literal("undo"), card: z.number().int(), at }),
  z.object({ t: z.literal("resend"), at }),
  z.object({ t: z.literal("next") }),
  z.object({ t: z.literal("note"), item: z.string().max(64), text: z.string().min(1).max(MAX_NOTE), at }),
  z.object({ t: z.literal("apply"), note: z.string().max(64), lines: z.array(z.number().int().min(0).max(20)).max(20), at }),
  z.object({ t: z.literal("unapply"), note: z.string().max(64), at }),
  z.object({ t: z.literal("dismiss"), note: z.string().max(64) }),
]);
export type Action = z.infer<typeof actionSchema>;

/** What an action did: whether it changed anything, and the refusal shown to the person if not. */
export type Outcome = { changed: boolean; problem?: string };

const iso = (ms: number) => new Date(ms).toISOString();
const card = (alertId: number) => PHONE_CARDS.find((c) => c.alertId === alertId);

/**
 * Readings by item, day and text. A replay of a fixture reading is cheap, but a
 * live reading (READER=claude) must not call the model again on every request.
 */
const readings = new Map<string, ReaderResult>();
const MAX_CACHED = 500;

async function cachedReading(box: Sandbox, itemId: string, text: string): Promise<ReaderResult> {
  const key = `${itemId}|${box.today}|${text}`;
  const hit = readings.get(key);
  if (hit) return hit;
  const item = box.ledger.items.get(itemId)!;
  const result = await readNote({ today: box.today, text, candidates: [item] });
  readings.set(key, result);
  if (readings.size > MAX_CACHED) readings.delete(readings.keys().next().value as string);
  return result;
}

export async function applyAction(box: Sandbox, action: Action): Promise<Outcome> {
  switch (action.t) {
    case "tap": {
      const c = card(action.card);
      if (!c || box.decisions.has(c.alertId)) return { changed: false };
      if (action.d === "bought") {
        sendEvents(box, [boughtEvent(c, `phone:${c.alertId}:bought:${box.log.length}`, ACTOR, iso(action.at))], iso(action.at));
      }
      // A skip stays on the radar's side: nothing is sent to the ledger.
      box.decisions.set(c.alertId, action.d);
      return { changed: true };
    }
    case "undo": {
      const c = card(action.card);
      if (!c || box.decisions.get(c.alertId) !== "bought") return { changed: false };
      const [result] = sendEvents(box, [removedEvent(c, `phone:${c.alertId}:undo:${box.log.length}`, ACTOR, iso(action.at))], iso(action.at));
      if (result?.status === "applied") box.decisions.delete(c.alertId);
      return { changed: true };
    }
    case "resend":
      if (!box.lastEvent) return { changed: false };
      sendEvents(box, [box.lastEvent], iso(action.at));
      return { changed: true };
    case "next":
      if (box.shown >= PHONE_CARDS.length) return { changed: false };
      box.shown += 1;
      return { changed: true };
    case "note": {
      const item = box.ledger.items.get(action.item);
      const text = action.text.trim();
      if (!item || !text) return { changed: false };
      const reading = await cachedReading(box, item.id, text);
      box.ledger.notes.push({
        id: nextId(box.ledger, "note"),
        itemId: item.id,
        text,
        actor: ACTOR,
        via: "app",
        at: iso(action.at),
        reading: reading.status === "ready" ? { status: "ready", output: reading.output, dropped: reading.dropped, source: reading.source } : reading,
        readAtVersion: item.version,
        suggestion: "open",
        applied: [],
      });
      return { changed: true };
    }
    case "apply": {
      const result = applySuggestion(box.ledger, action.note, action.lines, ACTOR, iso(action.at));
      return result.ok ? { changed: true } : { changed: false, problem: result.reason };
    }
    case "unapply": {
      const result = undoApply(box.ledger, action.note, ACTOR, iso(action.at));
      return result.ok ? { changed: true } : { changed: false, problem: result.reason };
    }
    case "dismiss":
      return { changed: dismissSuggestion(box.ledger, action.note).ok };
  }
}
