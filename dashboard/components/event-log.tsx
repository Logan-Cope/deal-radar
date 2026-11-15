import { resendLast } from "@/app/actions";
import type { Sandbox } from "@/lib/demo/sandbox";
import { Submit } from "./submit";

/** The radar events this visitor's taps sent, and how the ledger answered each. */
export function EventLog({ box }: { box: Sandbox }) {
  return (
    <section className="events" aria-labelledby="events-title">
      <h2 className="section-title" id="events-title">
        Events sent to the ledger
      </h2>
      {box.log.length === 0 ? (
        <p className="muted">Tap Bought on a card and the event it sends shows up here with the ledger&rsquo;s answer.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Answer</th>
            </tr>
          </thead>
          <tbody>
            {box.log.map((entry, i) => (
              <tr key={`${entry.id}-${i}`}>
                <td>
                  <code>{entry.type}</code>
                  <br />
                  <code className="muted">{entry.id}</code>
                </td>
                <td className={`status-${entry.status}`}>{entry.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form action={resendLast}>
        <Submit disabled={!box.lastEvent}>Send the last event again</Submit>
      </form>
    </section>
  );
}
