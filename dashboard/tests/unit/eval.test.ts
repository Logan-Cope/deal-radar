import { describe, expect, it } from "vitest";
import { CASES } from "@/evals/reader/cases";
import { report, scoreCase } from "@/evals/reader/score";
import { seedState } from "@/lib/demo/seed";
import { readNote } from "@/lib/reader/read";

const TODAY = "2026-11-15";

describe("reader eval on the fixture readings", () => {
  it("passes the ship gate: every proposed change is right, none is missed", async () => {
    const state = seedState(TODAY);
    const scores = [];
    for (const c of CASES) {
      const item = state.items.get(c.itemId)!;
      const result = await readNote({ today: TODAY, text: c.note, candidates: [item] });
      scores.push(scoreCase(c, result.status === "ready" ? result.output : null, TODAY));
    }
    const r = report(scores);
    expect(r.cases.filter((c) => c.wrong.length || c.missed.length)).toEqual([]);
    expect(r).toMatchObject({ precision: 1, recall: 1, pass: true });
  });

  it("the checks hold back both planted slips", async () => {
    const state = seedState(TODAY);
    const pell = await readNote({ today: TODAY, text: "sold the loafers for 360, payout 309.12", candidates: [state.items.get("itm_pell")!] });
    const vesper = await readNote({ today: TODAY, text: "payout was actually 268.10 after the fee refund", candidates: [state.items.get("itm_vesper")!] });
    expect(pell.status === "ready" && pell.dropped.map((d) => d.reason)).toEqual(["the evidence is not a quote from the note"]);
    expect(vesper.status === "ready" && vesper.dropped.map((d) => d.reason)).toEqual(["the amount is not in its evidence"]);
  });

  it("scores a wrong change against precision", () => {
    const c = CASES.find((x) => x.id === "question-not-fact")!;
    const s = scoreCase(c, { item_ref: c.itemId, changes: [{ item_ref: c.itemId, field: "posted_price", value: "450.00", evidence: "at 450", confidence: "low" }], unclear: [] }, TODAY);
    expect(report([s])).toMatchObject({ precision: 0, pass: false });
  });
});
