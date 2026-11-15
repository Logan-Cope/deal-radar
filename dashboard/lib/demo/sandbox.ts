/**
 * The ledger a request works on, plus the demo phone's state.
 *
 * Demo mode: built fresh on every request from the seed and the visitor's own
 * action log (lib/demo/session.ts), so it lives in no server's memory.
 * Shared mode (RADAR_TOKEN set): one ledger in this process's memory, which a
 * real radar pushes to through /api/radar/events.
 */
import { toDay } from "@/lib/ledger/dates";
import { applyRadarEvents, type RadarEventInput, type RadarResult } from "@/lib/ledger/events";
import type { LedgerState } from "@/lib/ledger/state";
import { seedState } from "./seed";

export type Decision = "bought" | "skipped";
export type LogEntry = { id: string; type: string; status: string; error?: string };

export type Sandbox = {
  today: string;
  ledger: LedgerState;
  /** How many phone cards have arrived, and what was decided on each. */
  shown: number;
  decisions: Map<number, Decision>;
  /** The radar events sent, newest first, with the ledger's answer. */
  log: LogEntry[];
  lastEvent: RadarEventInput | null;
};

export const sharedMode = (): boolean => Boolean(process.env.RADAR_TOKEN);

export function newSandbox(today: string = toDay(Date.now())): Sandbox {
  return { today, ledger: seedState(today), shown: 1, decisions: new Map(), log: [], lastEvent: null };
}

let shared: Sandbox | null = null;

/** The one ledger of shared mode. */
export function sharedBox(): Sandbox {
  shared ??= newSandbox();
  return shared;
}

/** For tests: forget the shared ledger. */
export function resetShared(): void {
  shared = null;
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
