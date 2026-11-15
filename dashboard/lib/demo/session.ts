import { cookies, headers } from "next/headers";
import { ledgerAccess } from "./auth";
import { SANDBOX_COOKIE, sandboxFor, type Sandbox } from "./sandbox";

export class NotAllowedError extends Error {}

/**
 * This visitor's sandbox key and sandbox. In shared mode the ledger password is
 * checked here too, so no page or server action relies on the proxy alone.
 */
export async function session(): Promise<{ key: string; box: Sandbox }> {
  const access = ledgerAccess((await headers()).get("authorization"));
  if (access === "denied" || access === "unconfigured") throw new NotAllowedError("The shared ledger needs its password.");
  const key = (await cookies()).get(SANDBOX_COOKIE)?.value ?? "anonymous";
  return { key, box: sandboxFor(key) };
}
