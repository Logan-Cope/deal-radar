import Link from "next/link";
import type { Sandbox } from "@/lib/demo/sandbox";
import { formatMoney } from "@/lib/ledger/money";
import { inTab, realizedProfitCents, statusLine, tabLabel, TABS, unsoldLine, type Tab } from "@/lib/ledger/stage";
import { listItems } from "@/lib/ledger/state";

export function Ledger({ box, tab }: { box: Sandbox; tab: Tab }) {
  const items = listItems(box.ledger);
  const shown = items.filter((i) => inTab(i, tab));
  const profit = realizedProfitCents(items);
  return (
    <section className="ledger" aria-labelledby="ledger-title">
      <div className="ledger-head">
        <h2 className="section-title" id="ledger-title">
          Ledger
        </h2>
        <p className="ledger-totals">
          {unsoldLine(items)}. {formatMoney(profit)} made on sold items.
        </p>
      </div>
      <ul className="tabs" aria-label="Filter by stage">
        {TABS.map((t) => {
          const count = items.filter((i) => inTab(i, t)).length;
          if (count === 0 && t !== "all" && t !== tab) return null;
          return (
            <li key={t}>
              <Link href={t === "all" ? "/" : `/?tab=${t}`} aria-current={t === tab ? "page" : undefined} scroll={false}>
                {tabLabel(t)}
                <span className="count">{count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 ? (
        <p className="empty">Nothing here. Tap Bought on a card to add one.</p>
      ) : (
        <ul className="rows">
          {shown.map((item) => {
            const status = statusLine(item, box.today);
            return (
              <li key={item.id}>
                <Link href={`/items/${item.id}`} className="row">
                  <span>
                    <span className="row-brand">{item.brand}</span>
                    <br />
                    <span className="row-name">{item.name}</span>
                  </span>
                  <span className="row-money">
                    {formatMoney(item.paidCents)}
                    <small>{item.paidIsSticker ? "sticker" : "paid"}</small>
                  </span>
                  <span className={`row-status${status.attention ? " attention" : ""}`}>{status.text}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
