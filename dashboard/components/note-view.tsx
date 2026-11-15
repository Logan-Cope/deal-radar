import { applyNote, dismissNote, undoNote } from "@/app/actions";
import type { Note } from "@/lib/ledger/state";
import { formatMoney, parseMoney } from "@/lib/ledger/money";
import { suggestionLines } from "@/lib/ledger/suggestions";
import { byline } from "@/lib/ledger/via";
import { MONEY_FIELDS, type ReaderField } from "@/lib/reader/schema";
import { Submit } from "./submit";

const FAILURES: Record<string, string> = {
  no_fixture: "No reading: the demo has fixture readings for the sample notes only.",
  no_api_key: "No reading: READER=claude is set but ANTHROPIC_API_KEY is not.",
  refusal: "No reading: the model declined this note.",
  timeout: "No reading: the model did not answer in time.",
};

const FIELD_LABELS: Record<string, string> = {
  arrived_on: "Arrived",
  posted_on: "Posted date",
  posted_where: "Posted on",
  posted_price: "Posted price",
  sold_on: "Sold date",
  sold_price: "Sold price",
  payout: "Payout",
  size: "Size",
  paid: "Paid",
};

/** A held-back value as a person reads it: money as money, everything else as written. */
function heldValue(field: string, value: string): string {
  const cents = MONEY_FIELDS.includes(field as ReaderField) ? parseMoney(value) : null;
  return cents === null ? value : formatMoney(cents);
}

export function NoteView({ note, today }: { note: Note; today: string }) {
  const reading = note.reading;
  const lines = suggestionLines(note, today);
  return (
    <article className="note">
      <p className="note-text">&ldquo;{note.text}&rdquo;</p>
      <p className="note-meta">
        {byline(note.actor, note.via)}
      </p>
      {reading.status === "failed" ? (
        <p className="muted">{FAILURES[reading.error] ?? `No reading (${reading.error}).`}</p>
      ) : (
        <div className="suggestion">
          {lines.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing to change.
            </p>
          ) : note.suggestion === "applied" ? (
            <>
              <ul className="unclear" style={{ fontSize: "inherit", marginTop: 0 }}>
                {lines.map((l) => (
                  <li key={l.index}>{l.text}</li>
                ))}
              </ul>
              <div className="suggestion-actions">
                <span className="status-applied">Applied</span>
                <form action={undoNote}>
                  <input type="hidden" name="noteId" value={note.id} />
                  <Submit className="btn btn-quiet">Undo</Submit>
                </form>
              </div>
            </>
          ) : note.suggestion === "dismissed" ? (
            <p className="muted" style={{ margin: 0 }}>
              Dismissed.
            </p>
          ) : (
            <form action={applyNote}>
              <input type="hidden" name="noteId" value={note.id} />
              <fieldset>
                <legend className="visually-hidden">Changes read from this note</legend>
                {lines.map((l) => (
                  <label className="line" key={l.index}>
                    <input type="checkbox" name="line" value={l.index} defaultChecked={l.ticked} />
                    <span className="line-text">{l.text}</span>
                    <span className="line-evidence">
                      <mark>{l.evidence}</mark>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="suggestion-actions">
                <Submit className="btn btn-primary" pendingLabel="Applying">
                  Apply
                </Submit>
                <Submit className="btn btn-quiet" formAction={dismissNote}>
                  Dismiss
                </Submit>
              </div>
            </form>
          )}
          {reading.output.unclear.length > 0 ? (
            <ul className="unclear">
              {reading.output.unclear.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : null}
          {reading.dropped.length > 0 ? (
            <details className="held">
              <summary>
                {reading.dropped.length} change{reading.dropped.length === 1 ? "" : "s"} held back by the checks
              </summary>
              <ul>
                {reading.dropped.map((d, i) => (
                  <li key={i}>
                    {FIELD_LABELS[d.change.field] ?? d.change.field} {heldValue(d.change.field, d.change.value)}: {d.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </article>
  );
}
