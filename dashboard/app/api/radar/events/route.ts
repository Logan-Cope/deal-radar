/**
 * The radar's push endpoint: POST {"events": [...]} with `Authorization: Bearer
 * <RADAR_TOKEN>`. Answers one result per event, in order. Off (404) unless
 * RADAR_TOKEN is set, so the public demo exposes no write endpoint.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendEvents, sharedBox } from "@/lib/demo/sandbox";
import { MAX_EVENTS_PER_REQUEST } from "@/lib/ledger/events";

function tokenMatches(header: string | null, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = process.env.RADAR_TOKEN;
  if (!token) return NextResponse.json({ error: "disabled" }, { status: 404 });
  if (!tokenMatches(request.headers.get("authorization"), token)) return NextResponse.json({ error: "bad_token" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) return NextResponse.json({ error: "expected {\"events\": [...]}" }, { status: 400 });
  if (events.length > MAX_EVENTS_PER_REQUEST) return NextResponse.json({ error: "too_many_events" }, { status: 413 });

  const results = sendEvents(sharedBox(), events, new Date().toISOString());
  return NextResponse.json({ results });
}
