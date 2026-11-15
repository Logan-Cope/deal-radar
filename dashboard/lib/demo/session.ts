import { cookies, headers } from "next/headers";
import { toDay } from "@/lib/ledger/dates";
import { applyAction, type Action, type Outcome } from "./act";
import { ledgerAccess } from "./auth";
import { decodeLog, encodeLog, fitsInCookie, LOG_COOKIE, type DemoLog } from "./log";
import { newSandbox, sharedBox, sharedMode, type Sandbox } from "./sandbox";

export class NotAllowedError extends Error {}

type Session = { mode: "demo"; box: Sandbox; log: DemoLog } | { mode: "shared"; box: Sandbox };

/** Rebuilds a demo ledger: the seed for the log's day, then every action in order. */
export async function replay(log: DemoLog): Promise<Sandbox> {
  const box = newSandbox(log.today);
  for (const action of log.actions) await applyAction(box, action);
  return box;
}

/**
 * The ledger this request works on. In shared mode the ledger password is
 * checked here as well as in the proxy, so no page or server action relies on
 * the proxy alone.
 */
export async function session(): Promise<Session> {
  const access = ledgerAccess((await headers()).get("authorization"));
  if (access === "denied" || access === "unconfigured") throw new NotAllowedError("The shared ledger needs its password.");
  if (sharedMode()) return { mode: "shared", box: sharedBox() };
  const log = decodeLog((await cookies()).get(LOG_COOKIE)?.value) ?? { today: toDay(Date.now()), actions: [] };
  return { mode: "demo", box: await replay(log), log };
}

const FULL = "The demo keeps a short history in your browser, and it is full. Reset demo to start over.";

/** Applies one action and, in the demo, saves it to the visitor's log. */
export async function perform(action: Action): Promise<Outcome> {
  const s = await session();
  if (s.mode === "demo") {
    const next = { ...s.log, actions: [...s.log.actions, action] };
    if (!fitsInCookie(next)) return { changed: false, problem: FULL };
    const outcome = await applyAction(s.box, action);
    if (outcome.changed) {
      (await cookies()).set(LOG_COOKIE, encodeLog(next), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
    }
    return outcome;
  }
  return applyAction(s.box, action);
}

export async function clearLog(): Promise<void> {
  (await cookies()).delete(LOG_COOKIE);
}
