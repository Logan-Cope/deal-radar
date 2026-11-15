"use server";
/**
 * Everything a visitor can do. Phone taps send the radar's own events through
 * applyRadarEvents; notes go through the reader and its checks; Apply and Undo
 * go through lib/ledger/suggestions.ts. No action trusts the form beyond ids
 * and text. Every action goes through session(), which checks the ledger
 * password in shared mode; in the demo each works on this visitor's sandbox only.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { boughtEvent, PHONE_CARDS, removedEvent } from "@/lib/demo/phone";
import { resetSandbox, sendEvents, sharedMode } from "@/lib/demo/sandbox";
import { NotAllowedError, session } from "@/lib/demo/session";
import { nextId } from "@/lib/ledger/state";
import { applySuggestion, dismissSuggestion, undoApply } from "@/lib/ledger/suggestions";
import { readNote } from "@/lib/reader/read";

const ACTOR = "You";
const MAX_NOTE = 1000;

const card = (alertId: number) => PHONE_CARDS.find((c) => c.alertId === alertId);
const nowIso = () => new Date().toISOString();

/** The simulated phone, the event replay and the reset exist in the demo only, never on a shared ledger. */
async function demoSession() {
  if (sharedMode()) throw new NotAllowedError("Demo controls are off on a shared ledger.");
  return session();
}

export async function decide(formData: FormData): Promise<void> {
  const { box } = await demoSession();
  const c = card(Number(formData.get("alertId")));
  const decision = formData.get("decision");
  if (!c || box.decisions.has(c.alertId)) return;
  if (decision === "bought") {
    sendEvents(box, [boughtEvent(c, `phone:${c.alertId}:bought:${box.log.length}`, ACTOR, nowIso())], nowIso());
    box.decisions.set(c.alertId, "bought");
  } else if (decision === "skipped") {
    // A skip stays on the radar's side: nothing is sent to the ledger.
    box.decisions.set(c.alertId, "skipped");
  }
  revalidatePath("/");
}

export async function undoBuy(formData: FormData): Promise<void> {
  const { box } = await demoSession();
  const c = card(Number(formData.get("alertId")));
  if (!c || box.decisions.get(c.alertId) !== "bought") return;
  const [result] = sendEvents(box, [removedEvent(c, `phone:${c.alertId}:undo:${box.log.length}`, ACTOR, nowIso())], nowIso());
  if (result?.status === "applied") box.decisions.delete(c.alertId);
  revalidatePath("/");
}

export async function resendLast(): Promise<void> {
  const { box } = await demoSession();
  if (box.lastEvent) sendEvents(box, [box.lastEvent], nowIso());
  revalidatePath("/");
}

export async function nextCard(): Promise<void> {
  const { box } = await demoSession();
  box.shown = Math.min(box.shown + 1, PHONE_CARDS.length);
  revalidatePath("/");
}

export async function resetDemo(): Promise<void> {
  const { key } = await demoSession();
  resetSandbox(key);
  redirect("/");
}

export async function addNote(formData: FormData): Promise<void> {
  const { box } = await session();
  const item = box.ledger.items.get(String(formData.get("itemId")));
  const text = String(formData.get("text") ?? "").trim().slice(0, MAX_NOTE);
  if (!item || !text) return;
  const reading = await readNote({ today: box.today, text, candidates: [item] });
  box.ledger.notes.push({
    id: nextId(box.ledger, "note"),
    itemId: item.id,
    text,
    actor: ACTOR,
    via: "app",
    at: nowIso(),
    reading: reading.status === "ready" ? { status: "ready", output: reading.output, dropped: reading.dropped, source: reading.source } : reading,
    readAtVersion: item.version,
    suggestion: "open",
    applied: [],
  });
  revalidatePath(`/items/${item.id}`);
}

/** Shown under a card when Apply or Undo is refused, so the reason is never silent. */
async function refusal(itemPath: string, reason: string): Promise<never> {
  redirect(`${itemPath}?problem=${encodeURIComponent(reason)}`);
}

export async function applyNote(formData: FormData): Promise<void> {
  const { box } = await session();
  const noteId = String(formData.get("noteId"));
  const indexes = formData.getAll("line").map(Number).filter(Number.isInteger);
  const note = box.ledger.notes.find((n) => n.id === noteId);
  if (!note) return;
  const result = applySuggestion(box.ledger, noteId, indexes, ACTOR, nowIso());
  if (!result.ok) await refusal(`/items/${note.itemId}`, result.reason);
  revalidatePath(`/items/${note.itemId}`);
  revalidatePath("/");
}

export async function undoNote(formData: FormData): Promise<void> {
  const { box } = await session();
  const noteId = String(formData.get("noteId"));
  const note = box.ledger.notes.find((n) => n.id === noteId);
  if (!note) return;
  const result = undoApply(box.ledger, noteId, ACTOR, nowIso());
  if (!result.ok) await refusal(`/items/${note.itemId}`, result.reason);
  revalidatePath(`/items/${note.itemId}`);
  revalidatePath("/");
}

export async function dismissNote(formData: FormData): Promise<void> {
  const { box } = await session();
  const noteId = String(formData.get("noteId"));
  const note = box.ledger.notes.find((n) => n.id === noteId);
  if (!note) return;
  dismissSuggestion(box.ledger, noteId);
  revalidatePath(`/items/${note.itemId}`);
}
