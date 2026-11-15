import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/radar/events/route";
import { applyAction, type Action } from "@/lib/demo/act";
import { decodeLog, encodeLog, fitsInCookie } from "@/lib/demo/log";
import { boughtEvent, PHONE_CARDS } from "@/lib/demo/phone";
import { newSandbox, resetShared, sendEvents, sharedBox } from "@/lib/demo/sandbox";
import { replay } from "@/lib/demo/session";

const TODAY = "2026-11-15";
const T = Date.parse(`${TODAY}T15:00:00Z`);
const card = PHONE_CARDS[0]!;

afterEach(() => {
  vi.unstubAllEnvs();
  resetShared();
});

async function run(actions: Action[]) {
  const box = newSandbox(TODAY);
  const outcomes = [];
  for (const a of actions) outcomes.push(await applyAction(box, a));
  return { box, outcomes };
}

describe("demo actions", () => {
  it("a tap on Bought sends the radar's event, and a resend is a duplicate", async () => {
    const { box } = await run([
      { t: "tap", card: card.alertId, d: "bought", at: T },
      { t: "resend", at: T + 1 },
    ]);
    expect(box.ledger.items.size).toBe(6);
    expect(box.log.map((l) => l.status)).toEqual(["duplicate", "applied"]);
  });

  it("a skip records the decision and sends nothing", async () => {
    const { box } = await run([{ t: "tap", card: card.alertId, d: "skipped", at: T }]);
    expect(box.log).toEqual([]);
    expect(box.decisions.get(card.alertId)).toBe("skipped");
  });

  it("undo removes an untouched buy, and a second tap on the same card is ignored", async () => {
    const { box, outcomes } = await run([
      { t: "tap", card: card.alertId, d: "bought", at: T },
      { t: "tap", card: card.alertId, d: "skipped", at: T + 1 },
      { t: "undo", card: card.alertId, at: T + 2 },
    ]);
    expect(outcomes.map((o) => o.changed)).toEqual([true, false, true]);
    expect(box.ledger.items.size).toBe(5);
  });

  it("a note is read, and a refused Apply reports why", async () => {
    const { box, outcomes } = await run([
      { t: "note", item: "itm_halden", text: "trench came today! tag says M", at: T },
      { t: "apply", note: "note_does_not_exist", lines: [0], at: T + 1 },
    ]);
    expect(box.ledger.notes[0]?.reading.status).toBe("ready");
    expect(outcomes[1]).toMatchObject({ changed: false, problem: "Nothing to apply." });
  });
});

describe("replay", () => {
  const actions: Action[] = [
    { t: "tap", card: card.alertId, d: "bought", at: T },
    { t: "next" },
    { t: "note", item: "itm_tessel", text: "listed the tessel boots on ebay yesterday for 425", at: T + 10 },
  ];

  it("rebuilds the same ledger from the same log, ids included", async () => {
    const first = await replay({ today: TODAY, actions });
    const noteId = first.ledger.notes[0]!.id;
    const withApply = await replay({ today: TODAY, actions: [...actions, { t: "apply", note: noteId, lines: [0, 1, 2], at: T + 20 }] });
    expect(withApply.ledger.items.get("itm_tessel")).toMatchObject({ postedWhere: "eBay", postedPriceCents: 42500 });
    const again = await replay({ today: TODAY, actions });
    expect([...again.ledger.items.keys()]).toEqual([...first.ledger.items.keys()]);
    expect(again.shown).toBe(2);
  });

  it("round-trips through the cookie and rejects a tampered one", () => {
    const log = { today: TODAY, actions };
    expect(decodeLog(encodeLog(log), TODAY)).toEqual(log);
    expect(decodeLog("not-base64-json", TODAY)).toBeNull();
    const forge = (body: unknown) => Buffer.from(JSON.stringify(body)).toString("base64url");
    expect(decodeLog(forge({ v: 1, today: TODAY, actions: [{ t: "tap", card: 1, d: "refund", at: T }] }), TODAY)).toBeNull();
    // A timestamp Date cannot format would break every page for this visitor.
    expect(decodeLog(forge({ v: 1, today: TODAY, actions: [{ t: "resend", at: 1e16 }] }), TODAY)).toBeNull();
  });

  it("starts over from a log that is too big or from another week", () => {
    expect(decodeLog(encodeLog({ today: "2026-11-01", actions }), TODAY)).toBeNull();
    expect(decodeLog(encodeLog({ today: "2026-11-14", actions }), TODAY)).not.toBeNull();
    expect(decodeLog("A".repeat(4000), TODAY)).toBeNull();
    const many = Array.from({ length: 121 }, (): Action => ({ t: "next" }));
    expect(decodeLog(encodeLog({ today: TODAY, actions: many }), TODAY)).toBeNull();
  });

  it("never reads live in the demo, even with READER=claude set", async () => {
    vi.stubEnv("READER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const box = await replay({ today: TODAY, actions: [{ t: "note", item: "itm_halden", text: "trench came today! tag says M", at: T }] });
    const reading = box.ledger.notes[0]!.reading;
    expect(reading.status === "ready" && reading.source).toBe("fixture");
  });

  it("knows when the log would no longer fit in a cookie", () => {
    const long = "x".repeat(900);
    const notes = (n: number): Action[] => Array.from({ length: n }, (_, i) => ({ t: "note", item: "itm_tessel", text: long, at: T + i }));
    expect(fitsInCookie({ today: TODAY, actions: notes(1) })).toBe(true);
    expect(fitsInCookie({ today: TODAY, actions: notes(4) })).toBe(false);
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

  it("answers one result per event, in order, on the shared ledger", async () => {
    vi.stubEnv("RADAR_TOKEN", "s3cret-token");
    const event = boughtEvent(card, "api-1", "Sam", `${TODAY}T12:00:00.000Z`);
    const res = await post({ events: [event, event, { id: "x", type: "nope" }] }, "s3cret-token");
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.map((r: { status: string }) => r.status)).toEqual(["applied", "duplicate", "rejected"]);
    expect(sharedBox().ledger.items.size).toBe(6);
  });

  it("refuses more than 50 events in one request", async () => {
    vi.stubEnv("RADAR_TOKEN", "s3cret-token");
    expect((await post({ events: Array.from({ length: 51 }, () => ({})) }, "s3cret-token")).status).toBe(413);
  });

  it("keeps the event log to the last 20 answers", () => {
    const box = newSandbox(TODAY);
    for (let i = 0; i < 25; i++) sendEvents(box, [boughtEvent(card, `e${i}`, "Sam", `${TODAY}T12:00:00.000Z`)], `${TODAY}T12:00:00.000Z`);
    expect(box.log).toHaveLength(20);
  });
});
