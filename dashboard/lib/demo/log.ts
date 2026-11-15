/**
 * A demo visitor's history: the day their sandbox started and every action
 * they took, kept in their own cookie. The server holds no demo state, so any
 * instance can rebuild any visitor's ledger, and no visitor can see another's.
 *
 * The cookie is not signed, because editing it can only change the editor's
 * own demo: replay reads from fixtures only (lib/demo/act.ts), and decoding
 * enforces the same size and count limits the app writes under.
 */
import { z } from "zod";
import { addDays, compareDates, isDateString } from "@/lib/ledger/dates";
import { actionSchema, type Action } from "./act";

export const LOG_COOKIE = "dr_log";
/** Browsers keep about 4 KB per cookie; stay under it with room for the name and attributes. */
export const MAX_LOG_BYTES = 3500;
export const MAX_ACTIONS = 120;
/** A log from further away than this (a forged or very old one) starts over. */
const MAX_DAYS_FROM_TODAY = 2;

const logSchema = z.object({ v: z.literal(1), today: z.string().refine(isDateString), actions: z.array(actionSchema).max(MAX_ACTIONS) });
export type DemoLog = { today: string; actions: Action[] };

export function encodeLog(log: DemoLog): string {
  return Buffer.from(JSON.stringify({ v: 1, ...log }), "utf8").toString("base64url");
}

/** The log in a cookie value, or null when it is missing, too big, too old, damaged or edited into something invalid. */
export function decodeLog(value: string | undefined, today: string): DemoLog | null {
  if (!value || value.length > MAX_LOG_BYTES) return null;
  try {
    const parsed = logSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const day = parsed.data.today;
    if (compareDates(day, addDays(today, -MAX_DAYS_FROM_TODAY)) < 0 || compareDates(day, addDays(today, MAX_DAYS_FROM_TODAY)) > 0) return null;
    return { today: day, actions: parsed.data.actions };
  } catch {
    return null;
  }
}

export const fitsInCookie = (log: DemoLog): boolean => log.actions.length <= MAX_ACTIONS && encodeLog(log).length <= MAX_LOG_BYTES;
