"use server";
/**
 * The forms' server actions. Each one reads ids and text from the form, builds
 * an Action (lib/demo/act.ts) and performs it through session(), which checks
 * the ledger password in shared mode and, in the demo, saves the action to the
 * visitor's own log. A refused action comes back to the page as `?problem=`,
 * so a refusal is never silent.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MAX_NOTE, type Action } from "@/lib/demo/act";
import { sharedMode } from "@/lib/demo/sandbox";
import { clearLog, NotAllowedError, perform, session } from "@/lib/demo/session";

async function run(action: Action, path: string): Promise<void> {
  const outcome = await perform(action);
  if (outcome.problem) redirect(`${path}?problem=${encodeURIComponent(outcome.problem)}`);
  revalidatePath(path);
}

/** The simulated phone, the event replay and the reset exist in the demo only, never on a shared ledger. */
function demoOnly(): void {
  if (sharedMode()) throw new NotAllowedError("Demo controls are off on a shared ledger.");
}

export async function decide(formData: FormData): Promise<void> {
  demoOnly();
  const d = formData.get("decision");
  if (d !== "bought" && d !== "skipped") return;
  await run({ t: "tap", card: Number(formData.get("alertId")), d, at: Date.now() }, "/");
}

export async function undoBuy(formData: FormData): Promise<void> {
  demoOnly();
  await run({ t: "undo", card: Number(formData.get("alertId")), at: Date.now() }, "/");
}

export async function resendLast(): Promise<void> {
  demoOnly();
  await run({ t: "resend", at: Date.now() }, "/");
}

export async function nextCard(): Promise<void> {
  demoOnly();
  await run({ t: "next" }, "/");
}

export async function resetDemo(): Promise<void> {
  demoOnly();
  await session();
  await clearLog();
  redirect("/");
}

const itemPath = (id: string) => `/items/${encodeURIComponent(id)}`;

/** The item a note belongs to, for the path to send the person back to. */
async function noteItem(noteId: string): Promise<string | null> {
  const { box } = await session();
  return box.ledger.notes.find((n) => n.id === noteId)?.itemId ?? null;
}

export async function addNote(formData: FormData): Promise<void> {
  const item = String(formData.get("itemId") ?? "");
  const text = String(formData.get("text") ?? "").trim().slice(0, MAX_NOTE);
  if (!item || !text) return;
  await run({ t: "note", item, text, at: Date.now() }, itemPath(item));
}

export async function applyNote(formData: FormData): Promise<void> {
  const note = String(formData.get("noteId") ?? "");
  const item = await noteItem(note);
  if (!item) return;
  const lines = formData.getAll("line").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 20);
  await run({ t: "apply", note, lines, at: Date.now() }, itemPath(item));
  revalidatePath("/");
}

export async function undoNote(formData: FormData): Promise<void> {
  const note = String(formData.get("noteId") ?? "");
  const item = await noteItem(note);
  if (!item) return;
  await run({ t: "unapply", note, at: Date.now() }, itemPath(item));
  revalidatePath("/");
}

export async function dismissNote(formData: FormData): Promise<void> {
  const note = String(formData.get("noteId") ?? "");
  const item = await noteItem(note);
  if (!item) return;
  await run({ t: "dismiss", note }, itemPath(item));
}
