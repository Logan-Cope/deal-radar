import { afterEach, describe, expect, it, vi } from "vitest";
import { boughtEvent, PHONE_CARDS, removedEvent } from "@/lib/demo/phone";
import { resetSandbox, sandboxFor, sendEvents } from "@/lib/demo/sandbox";
import { POST } from "@/app/api/radar/events/route";

const NOW = "2026-11-15T12:00:00.000Z";
const card = PHONE_CARDS[0]!;

afterEach(() => {
  vi.unstubAllEnvs();
  resetSandbox("a");
  resetSandbox("b");
});

describe("sandboxes", () => {
  it("keeps visitors apart", () => {
    const a = sandboxFor("a");
    sendEvents(a, [boughtEvent(card, "e1", "You", NOW)], NOW);
    expect(a.ledger.items.size).toBe(6);
    expect(sandboxFor("b").ledger.items.size).toBe(5);
  });

  it("logs each event with the ledger's answer, and a resend is a duplicate", () => {
    const box = sandboxFor("a");
    sendEvents(box, [boughtEvent(card, "e1", "You", NOW)], NOW);
    sendEvents(box, [box.lastEvent!], NOW);
    expect(box.log.map((l) => l.status)).toEqual(["duplicate", "applied"]);
    expect(box.ledger.items.size).toBe(6);
  });

  it("undoes a buy from the phone while nobody has touched it", () => {
    const box = sandboxFor("a");
    sendEvents(box, [boughtEvent(card, "e1", "You", NOW)], NOW);
    const [result] = sendEvents(box, [removedEvent(card, "e2", "You", NOW)], NOW);
    expect(result?.status).toBe("applied");
    expect(box.ledger.items.size).toBe(5);
  });

  it("starts fresh after a reset", () => {
    sendEvents(sandboxFor("a"), [boughtEvent(card, "e1", "You", NOW)], NOW);
    resetSandbox("a");
    expect(sandboxFor("a").ledger.items.size).toBe(5);
  });
});

describe("POST /api/radar/events", () => {
  const post = (body: unknown, token?: string) =>
    POST(new Request("http://localhost/api/radar/events", { method: "POST", body: JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} }));

  it("is off without RADAR_TOKEN", async () => {
    vi.stubEnv("RADAR_TOKEN", "");
    expect((await post({ events: [] })).status).toBe(404);
  });

  it("refuses a wrong token", async () => {
    vi.stubEnv("RADAR_TOKEN", "s3cret-token");
    const res = await post({ events: [] }, "wrong");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "bad_token" });
  });

  it("answers one result per event, in order", async () => {
    vi.stubEnv("RADAR_TOKEN", "s3cret-token");
    const event = boughtEvent(card, "api-1", "Sam", NOW);
    const res = await post({ events: [event, event, { id: "x", type: "nope" }] }, "s3cret-token");
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.map((r: { status: string }) => r.status)).toEqual(["applied", "duplicate", "rejected"]);
    resetSandbox("shared");
  });

  it("refuses more than 50 events in one request", async () => {
    vi.stubEnv("RADAR_TOKEN", "s3cret-token");
    expect((await post({ events: Array.from({ length: 51 }, () => ({})) }, "s3cret-token")).status).toBe(413);
  });
});
