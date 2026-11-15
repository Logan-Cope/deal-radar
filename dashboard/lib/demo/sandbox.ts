/**
 * Where the ledger lives. The public demo gives every visitor a private
 * sandbox in memory, keyed by a cookie, seeded fresh and reset by a server
 * restart, so one visitor never sees another's taps or notes. With
 * RADAR_TOKEN set (a real radar pushing to this app) there is one shared
 * ledger instead.
 */
import { toDay } from "@/lib/ledger/dates";
import { applyRadarEvents, type RadarEventInput, type RadarResult } from "@/lib/ledger/events";
import type { LedgerState } from "@/lib/ledger/state";
import { seedState } from "./seed";

export const SANDBOX_COOKIE = "dr_sandbox";
const MAX_SANDBOXES = 500;

export type Decision = "bought" | "skipped";
export type LogEntry = { id: string; type: string; status: string; error?: string };

export type Sandbox = {
  today: string;
  ledger: LedgerState;
  /** How many phone cards have arrived, and what was decided on each. */
  shown: number;
  decisions: Map<number, Decision>;
  /** The radar events this sandbox sent, newest first, with the ledger's answer. */
  log: LogEntry[];
  lastEvent: RadarEventInput | null;
};

const sandboxes = new Map<string, Sandbox>();

export const sharedMode = (): boolean => Boolean(process.env.RADAR_TOKEN);

export function newSandbox(now: number = Date.now()): Sandbox {
  const today = toDay(now);
  return { today, ledger: seedState(today), shown: 1, decisions: new Map(), log: [], lastEvent: null };
}

/** The sandbox for this visitor, created on first use. The oldest is dropped past the cap. */
export function sandboxFor(key: string): Sandbox {
  const id = sharedMode() ? "shared" : key;
  let box = sandboxes.get(id);
  if (!box) {
    box = newSandbox();
    sandboxes.set(id, box);
    if (sandboxes.size > MAX_SANDBOXES) sandboxes.delete(sandboxes.keys().next().value as string);
  } else {
    // Touch: re-insert so eviction drops the least recently used.
    sandboxes.delete(id);
    sandboxes.set(id, box);
  }
  return box;
}

export function resetSandbox(key: string): void {
  sandboxes.delete(sharedMode() ? "shared" : key);
}

/** Send events as the radar would, and keep the answers for the event log. */
export function sendEvents(box: Sandbox, events: RadarEventInput[], now: string): RadarResult[] {
  const results = applyRadarEvents(box.ledger, events, now);
  events.forEach((event, i) => {
    const r = results[i];
    box.log.unshift({ id: event.id, type: event.type, status: r?.status ?? "rejected", ...(r?.error ? { error: r.error } : {}) });
  });
  box.log = box.log.slice(0, 20);
  if (events.length) box.lastEvent = events[events.length - 1] ?? null;
  return results;
}
