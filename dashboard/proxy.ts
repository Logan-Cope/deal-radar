/**
 * Runs before every page and server action.
 *
 * Demo mode: gives each visitor a sandbox id on first request. The cookie is
 * set on the response and on the request itself, so the very first render
 * already sees it.
 *
 * Shared mode (RADAR_TOKEN set): asks for the ledger password. lib/demo/session.ts
 * checks it again, so an action is never protected by this file alone.
 */
import { NextResponse, type NextRequest } from "next/server";
import { LEDGER_REALM, ledgerAccess } from "@/lib/demo/auth";
import { SANDBOX_COOKIE } from "@/lib/demo/sandbox";

export function proxy(request: NextRequest): NextResponse {
  const access = ledgerAccess(request.headers.get("authorization"));
  if (access === "unconfigured") return new NextResponse("Set LEDGER_PASSWORD to use the shared ledger.\n", { status: 503 });
  if (access === "denied") return new NextResponse("Password required.\n", { status: 401, headers: { "WWW-Authenticate": LEDGER_REALM } });
  if (access === "granted" || request.cookies.get(SANDBOX_COOKIE)) return NextResponse.next();

  const id = crypto.randomUUID();
  request.cookies.set(SANDBOX_COOKIE, id);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(SANDBOX_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/" });
  return response;
}

export const config = {
  // Pages and server actions. The radar's API route authenticates with its own bearer token.
  matcher: ["/((?!api/|_next/|favicon.svg|icon.svg).*)"],
};
