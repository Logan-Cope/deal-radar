/**
 * A demo visitor's history: the day their sandbox started and every action
 * they took, kept in their own cookie. The server holds no demo state, so any
 * instance can rebuild any visitor's ledger, and no visitor can see another's.
 */
import { z } from "zod";
import { isDateString } from "@/lib/ledger/dates";
import { actionSchema, type Action } from "./act";

export const LOG_COOKIE = "dr_log";
/** Browsers keep about 4 KB per cookie; stay under it with room for the name and attributes. */
export const MAX_LOG_BYTES = 3500;

const logSchema = z.object({ v: z.literal(1), today: z.string().refine(isDateString), actions: z.array(actionSchema).max(200) });
export type DemoLog = { today: string; actions: Action[] };

export function encodeLog(log: DemoLog): string {
  return Buffer.from(JSON.stringify({ v: 1, ...log }), "utf8").toString("base64url");
}

/** The log in a cookie value, or null when it is missing, damaged or edited into something invalid. */
export function decodeLog(value: string | undefined): DemoLog | null {
  if (!value) return null;
  try {
    const parsed = logSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? { today: parsed.data.today, actions: parsed.data.actions } : null;
  } catch {
    return null;
  }
}

export const fitsInCookie = (log: DemoLog): boolean => encodeLog(log).length <= MAX_LOG_BYTES;
