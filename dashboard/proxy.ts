/**
 * Shared mode (RADAR_TOKEN set) asks for the ledger password before any page
 * or server action. lib/demo/session.ts checks it again, so nothing is
 * protected by this file alone. The demo needs nothing here: each visitor's
 * ledger is rebuilt from their own cookie.
 */
import { NextResponse, type NextRequest } from "next/server";
import { LEDGER_REALM, ledgerAccess } from "@/lib/demo/auth";

export function proxy(request: NextRequest): NextResponse {
  const access = ledgerAccess(request.headers.get("authorization"));
  if (access === "unconfigured") return new NextResponse("Set LEDGER_PASSWORD to use the shared ledger.\n", { status: 503 });
  if (access === "denied") return new NextResponse("Password required.\n", { status: 401, headers: { "WWW-Authenticate": LEDGER_REALM } });
  return NextResponse.next();
}

export const config = {
  // Pages and server actions. The radar's API route authenticates with its own bearer token.
  matcher: ["/((?!api/|_next/|favicon.svg|icon.svg).*)"],
};
