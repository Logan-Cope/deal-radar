import { describe, expect, it } from "vitest";
import { seedItems } from "@/lib/demo/seed";
import { amountsIn, checkReading, normalizeQuote } from "@/lib/reader/check";
import type { ReaderChange } from "@/lib/reader/schema";
import type { Item } from "@/lib/ledger/types";

const TODAY = "2026-11-15";
const items: Item[] = seedItems(TODAY).map((i) => ({ ...i, version: 1 }));
const boot = items.find((i) => i.id === "itm_tessel")!;

function check(text: string, changes: Partial<ReaderChange>[]) {
  const full = changes.map((c) => ({ item_ref: boot.id, field: "posted_price", value: "425.00", evidence: "for 425", confidence: "high", ...c }) as ReaderChange);
  return checkReading({ item_ref: boot.id, changes: full, unclear: [] }, { today: TODAY, text, candidates: [boot] });
}

describe("checkReading", () => {
  it("keeps a change whose quote and amount are in the note", () => {
    const { output, dropped } = check("listed on ebay for 425", [{}]);
    expect(output.changes).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  it("drops a paraphrase", () => {
    expect(check("listed on ebay for 425", [{ evidence: "posted for 425" }]).dropped[0]?.reason).toBe("the evidence is not a quote from the note");
  });

  it("drops an amount that its evidence does not contain", () => {
    expect(check("listed it for 425", [{ value: "450.00", evidence: "listed it for 425" }]).dropped[0]?.reason).toBe("the amount is not in its evidence");
  });

  it("drops a change on an item that is not a candidate", () => {
    expect(check("for 425", [{ item_ref: "itm_other" }]).dropped[0]?.reason).toBe("not one of the candidate items");
  });

  it("drops future dates and dates before the purchase", () => {
    const text = "it came today";
    expect(check(text, [{ field: "arrived_on", value: "2026-11-16", evidence: "it came today" }]).dropped[0]?.reason).toBe("a date after the note was written");
    expect(check(text, [{ field: "arrived_on", value: "2020-01-01", evidence: "it came today" }]).dropped[0]?.reason).toBe("a date before the item was bought");
    expect(check(text, [{ field: "arrived_on", value: "2026-02-30", evidence: "it came today" }]).dropped[0]?.reason).toBe("not a real date");
  });

  it("canonicalizes the marketplace and refuses one the ledger does not track", () => {
    expect(check("on EBAY", [{ field: "posted_where", value: "EBAY", evidence: "on ebay" }]).output.changes[0]?.value).toBe("eBay");
    expect(check("on depop", [{ field: "posted_where", value: "Depop", evidence: "on depop" }]).dropped[0]?.reason).toBe("not a marketplace the ledger tracks");
  });

  it("drops a value equal to the current one", () => {
    expect(check("size 38", [{ field: "size", value: "38", evidence: "size 38" }]).dropped[0]?.reason).toBe("already the current value");
  });

  it("keeps one value per field per item", () => {
    const { output, dropped } = check("for 425, maybe for 430", [{}, { value: "430.00", evidence: "for 430" }]);
    expect(output.changes).toHaveLength(1);
    expect(dropped[0]?.reason).toBe("a second value for the same field");
  });

  it("clears an item_ref that is not a candidate", () => {
    const { output } = checkReading({ item_ref: "itm_nope", changes: [], unclear: [] }, { today: TODAY, text: "x", candidates: [boot] });
    expect(output.item_ref).toBe("");
  });
});

describe("helpers", () => {
  it("compares quotes without case, curly quotes or extra spaces", () => {
    expect(normalizeQuote("It’s  Here")).toBe("it's here");
  });

  it("finds every amount in a text", () => {
    expect(amountsIn("sold $1,150 payout 309.12 and 4")).toEqual([115000, 30912, 400]);
  });
});
