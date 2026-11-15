import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { addNote } from "@/app/actions";
import { NoteView } from "@/components/note-view";
import { Submit } from "@/components/submit";
import { compLine } from "@/lib/demo/phone";
import { session } from "@/lib/demo/session";
import { shortDate } from "@/lib/ledger/dates";
import { formatMoney } from "@/lib/ledger/money";
import { statusLine } from "@/lib/ledger/stage";
import { notesFor, updatesFor } from "@/lib/ledger/state";
import type { Item } from "@/lib/ledger/types";
import { byline } from "@/lib/ledger/via";
import { sampleNotes } from "@/lib/reader/fixtures";
import { liveReader } from "@/lib/reader/read";

function facts(item: Item, today: string): [string, string][] {
  const d = (day: string) => shortDate(day, today);
  const rows: [string, string][] = [
    ["Paid", item.paidIsSticker ? `${formatMoney(item.paidCents)} before shipping and tax` : formatMoney(item.paidCents)],
    ["Size", item.size ?? "Not set"],
    ["Bought", item.store ? `${d(item.boughtOn)} at ${item.store}` : d(item.boughtOn)],
  ];
  if (item.dueOn && !item.arrivedOn) rows.push(["Due", d(item.dueOn)]);
  if (item.retailCents != null) rows.push(["Retail", formatMoney(item.retailCents)]);
  if (item.arrivedOn) rows.push(["Arrived", d(item.arrivedOn)]);
  if (item.postedOn || item.postedWhere || item.postedPriceCents != null) {
    const parts = [item.postedOn ? d(item.postedOn) : null, item.postedWhere, item.postedPriceCents != null ? formatMoney(item.postedPriceCents) : null];
    rows.push(["Posted", parts.filter(Boolean).join(", ")]);
  }
  if (item.soldOn || item.soldPriceCents != null || item.payoutCents != null) {
    const parts = [
      item.soldOn ? d(item.soldOn) : null,
      item.soldPriceCents != null ? formatMoney(item.soldPriceCents) : null,
      item.payoutCents != null ? `payout ${formatMoney(item.payoutCents)}` : null,
    ];
    rows.push(["Sold", parts.filter(Boolean).join(", ")]);
  }
  return rows;
}

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ problem?: string }> }) {
  const { box } = await session();
  const { id } = await params;
  const { problem } = await searchParams;
  const item = box.ledger.items.get(id);
  if (!item) notFound();
  const status = statusLine(item, box.today);
  const notes = notesFor(box.ledger, item.id);
  const samples = liveReader() ? [] : sampleNotes(item.id).filter((s) => !notes.some((n) => n.text === s));
  const activity = updatesFor(box.ledger, item.id);

  return (
    <main className="item-page">
      <Link href="/" className="back">
        Back to the ledger
      </Link>
      <h1 className="item-title">{item.name}</h1>
      <p className="item-brand">{item.brand}</p>
      <p className={`item-status${status.attention ? " attention" : ""}`}>{status.text}</p>

      <dl className="facts">
        {facts(item, box.today).map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
      </dl>

      {item.comp ? (
        <section className="block" aria-labelledby="comp-title">
          <h2 id="comp-title">What the radar saw</h2>
          <p className="comp-line">
            {item.comp.verdict === "PASS" ? <mark>{compLine(item.comp)}</mark> : compLine(item.comp)}
            {item.comp.headroom != null ? `, leaving ${formatMoney(Math.round(item.comp.headroom * 100))} after fees and shipping.` : "."}
          </p>
        </section>
      ) : null}

      <section className="block" aria-labelledby="notes-title">
        <h2 id="notes-title">Notes</h2>
        {problem ? (
          <p className="problem" role="alert">
            {problem}
          </p>
        ) : null}
        {notes.map((note) => (
          <NoteView key={note.id} note={note} today={box.today} />
        ))}
        <form action={addNote} className="composer">
          <input type="hidden" name="itemId" value={item.id} />
          <label htmlFor="note-text" className="visually-hidden">
            Write a note about this item
          </label>
          <textarea id="note-text" name="text" maxLength={1000} placeholder="What happened to it? Arrived, listed, sold, paid out." required />
          <div className="composer-row">
            <Submit className="btn btn-primary" pendingLabel="Reading">
              Add note
            </Submit>
          </div>
        </form>
        {samples.length > 0 ? (
          <ul className="samples" aria-label="Sample notes">
            {samples.map((s) => (
              <li key={s}>
                <form action={addNote}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="text" value={s} />
                  <button type="submit">{s}</button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="block" aria-labelledby="activity-title">
        <h2 id="activity-title">Activity</h2>
        <ul className="activity">
          {activity.map((u) => (
            <li key={u.id}>
              <span className="muted">{shortDate(u.at.slice(0, 10), box.today)}</span>
              <span>
                {u.text}. {byline(u.actor, u.via)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
