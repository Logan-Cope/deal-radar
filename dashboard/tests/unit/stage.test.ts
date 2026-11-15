import { describe, expect, it } from "vitest";
import { seedItems } from "@/lib/demo/seed";
import { calendar, isDateString, shortDate } from "@/lib/ledger/dates";
import { formatMoney, parseMoney } from "@/lib/ledger/money";
import { inTab, isLate, realizedProfitCents, stageOf, statusLine, unsoldLine } from "@/lib/ledger/stage";

const TODAY = "2026-11-15";
const items = seedItems(TODAY).map((i) => ({ ...i, version: 1 }));
const byId = (id: string) => items.find((i) => i.id === id)!;

describe("stage", () => {
  it("is derived from the dates", () => {
    expect(items.map((i) => stageOf(i))).toEqual(["arrived", "on_the_way", "posted", "sold", "on_the_way"]);
  });

  it("marks late items and arrivals for attention, nothing else", () => {
    expect(statusLine(byId("itm_dune"), TODAY)).toEqual({ text: "Late, was due Nov 8", attention: true });
    expect(statusLine(byId("itm_tessel"), TODAY)).toEqual({ text: "Arrived Nov 10, not posted", attention: true });
    expect(statusLine(byId("itm_halden"), TODAY)).toEqual({ text: "On the way, due Nov 17", attention: false });
    expect(statusLine(byId("itm_pell"), TODAY).text).toBe("Posted Nov 6 on eBay at $395");
    expect(statusLine(byId("itm_vesper"), TODAY).text).toBe("Sold Nov 13 for $310");
  });

  it("counts an item with no due date late two weeks after purchase", () => {
    const item = { ...byId("itm_halden"), dueOn: null, boughtOn: "2026-10-31" };
    expect(isLate(item, TODAY)).toBe(true);
    expect(isLate({ ...item, boughtOn: "2026-11-02" }, TODAY)).toBe(false);
  });

  it("sums the money still tied up and the profit made", () => {
    expect(unsoldLine(items)).toBe("$249.40 in 4 unsold items");
    expect(realizedProfitCents(items)).toBe(26350 - 9100);
    expect(items.filter((i) => inTab(i, "on_the_way"))).toHaveLength(2);
  });
});

describe("money and dates", () => {
  it("formats and parses money", () => {
    expect(formatMoney(42500)).toBe("$425");
    expect(formatMoney(30912)).toBe("$309.12");
    expect(formatMoney(115000)).toBe("$1,150");
    expect(parseMoney("$1,150.5")).toBe(115050);
    expect(parseMoney("0")).toBeNull();
    expect(parseMoney("12.345")).toBeNull();
  });

  it("reads dates and builds the reader's calendar", () => {
    expect(isDateString("2026-02-29")).toBe(false);
    expect(shortDate("2026-11-14", TODAY)).toBe("Yesterday");
    expect(calendar(TODAY, 2)).toEqual(["2026-11-15 Sunday", "2026-11-14 Saturday"]);
  });
});
