/**
 * An item's stage is derived from its dates, never stored. One status line per
 * row does the work a status column and a badge would otherwise do.
 */
import { addDays, compareDates, shortDate } from "./dates";
import { formatMoney } from "./money";
import type { Item } from "./types";

export const STAGES = ["on_the_way", "arrived", "posted", "sold"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  on_the_way: "On the way",
  arrived: "Arrived",
  posted: "Posted",
  sold: "Sold",
};

/** With no due date, an item on the way counts as late this many days after purchase. */
export const LATE_AFTER_DAYS = 14;

type Dates = Pick<Item, "boughtOn" | "dueOn" | "arrivedOn" | "postedOn" | "soldOn">;

export function stageOf(item: Dates): Stage {
  if (item.soldOn) return "sold";
  if (item.postedOn) return "posted";
  if (item.arrivedOn) return "arrived";
  return "on_the_way";
}

export function isLate(item: Dates, today: string): boolean {
  if (stageOf(item) !== "on_the_way") return false;
  return compareDates(item.dueOn ?? addDays(item.boughtOn, LATE_AFTER_DAYS), today) < 0;
}

export type StatusLine = { text: string; attention: boolean };

/** Attention goes only to rows that need a person: late ones, and arrivals waiting to be posted. */
export function statusLine(item: Item, today: string): StatusLine {
  const d = (day: string) => shortDate(day, today);
  switch (stageOf(item)) {
    case "sold": {
      const price = item.soldPriceCents != null ? ` for ${formatMoney(item.soldPriceCents)}` : "";
      return { text: `Sold ${d(item.soldOn!)}${price}`, attention: false };
    }
    case "posted": {
      const where = item.postedWhere ? ` on ${item.postedWhere}` : "";
      const price = item.postedPriceCents != null ? ` at ${formatMoney(item.postedPriceCents)}` : "";
      return { text: `Posted ${d(item.postedOn!)}${where}${price}`, attention: false };
    }
    case "arrived":
      return { text: `Arrived ${d(item.arrivedOn!)}, not posted`, attention: true };
    case "on_the_way":
      if (isLate(item, today)) return { text: item.dueOn ? `Late, was due ${d(item.dueOn)}` : "Late", attention: true };
      return { text: item.dueOn ? `On the way, due ${d(item.dueOn)}` : "On the way", attention: false };
  }
}

export type Tab = "all" | Stage;
export const TABS: Tab[] = ["all", "on_the_way", "arrived", "posted", "sold"];
export const tabLabel = (tab: Tab): string => (tab === "all" ? "All" : STAGE_LABELS[tab]);
export const isTab = (value: unknown): value is Tab => TABS.includes(value as Tab);
export const inTab = (item: Item, tab: Tab): boolean => tab === "all" || stageOf(item) === tab;

/** `$412.40 in 3 unsold items`: the money still tied up. */
export function unsoldLine(items: Item[]): string {
  const unsold = items.filter((i) => stageOf(i) !== "sold");
  const cents = unsold.reduce((sum, i) => sum + i.paidCents, 0);
  return `${formatMoney(cents)} in ${unsold.length} unsold item${unsold.length === 1 ? "" : "s"}`;
}

/** Payout minus paid, over sold items where both are known. */
export function realizedProfitCents(items: Item[]): number {
  return items.filter((i) => i.soldOn && i.payoutCents != null).reduce((sum, i) => sum + (i.payoutCents! - i.paidCents), 0);
}
