/**
 * Shared mode (RADAR_TOKEN set) is one real ledger, so every page and every
 * server action needs a password: HTTP Basic, any user name, LEDGER_PASSWORD
 * as the password. Without LEDGER_PASSWORD the shared ledger refuses to serve.
 * The per-visitor demo needs none of this: each visitor only ever sees their
 * own sandbox.
 */
export const LEDGER_REALM = 'Basic realm="deal-radar ledger", charset="UTF-8"';

/** Compares in time that depends on the lengths only, not on where the strings differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** The password from an `Authorization: Basic` header, or null. */
export function basicPassword(header: string | null): string | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header?.trim() ?? "");
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = atob(match[1]);
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  return colon < 0 ? null : decoded.slice(colon + 1);
}

export type Access = "open" | "granted" | "denied" | "unconfigured";

/** Who may see the ledger: anyone in the demo; only the password holder in shared mode. */
export function ledgerAccess(header: string | null, env: Record<string, string | undefined> = process.env): Access {
  if (!env.RADAR_TOKEN) return "open";
  if (!env.LEDGER_PASSWORD) return "unconfigured";
  const given = basicPassword(header);
  return given !== null && constantTimeEqual(given, env.LEDGER_PASSWORD) ? "granted" : "denied";
}
