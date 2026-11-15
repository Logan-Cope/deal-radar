import { decide, nextCard, undoBuy } from "@/app/actions";
import { compLine, PHONE_CARDS, type PhoneCard } from "@/lib/demo/phone";
import type { Sandbox } from "@/lib/demo/sandbox";
import { Submit } from "./submit";

function Card({ card, decision, newest }: { card: PhoneCard; decision: string | undefined; newest: boolean }) {
  const evidence = compLine(card.comp);
  return (
    <article className={`card${newest ? " arrived" : ""}`} aria-label={`${card.brand} ${card.name}`}>
      <p className="card-kind">
        <span className="verdict">{card.verdict}</span> {card.kind.toLowerCase()} at {card.store}
      </p>
      <h3>
        <span className="brand">{card.brand}</span>
        {card.name}
      </h3>
      <div className="price">
        ${card.price}
        {card.was ? <s aria-label={`was $${card.was}`}>${card.was}</s> : null}
      </div>
      <dl>
        <dt>Why</dt>
        <dd>{card.why}</dd>
        <dt>Comp</dt>
        <dd>{card.comp.verdict === "PASS" ? <mark>{evidence}</mark> : evidence}</dd>
        <dt>Sizes</dt>
        <dd>{card.sizes.join(", ")}</dd>
      </dl>
      {decision ? (
        <div className="decided">
          <span>{decision === "bought" ? "Bought. Sent to the ledger." : "Skipped. Nothing sent."}</span>
          {decision === "bought" ? (
            <form action={undoBuy}>
              <input type="hidden" name="alertId" value={card.alertId} />
              <Submit className="btn btn-quiet">Undo</Submit>
            </form>
          ) : null}
        </div>
      ) : (
        <div className="card-actions">
          <form action={decide}>
            <input type="hidden" name="alertId" value={card.alertId} />
            <input type="hidden" name="decision" value="bought" />
            <Submit className="btn btn-primary">Bought</Submit>
          </form>
          <form action={decide}>
            <input type="hidden" name="alertId" value={card.alertId} />
            <input type="hidden" name="decision" value="skipped" />
            <Submit>Skip</Submit>
          </form>
        </div>
      )}
    </article>
  );
}

export function Phone({ box }: { box: Sandbox }) {
  const cards = PHONE_CARDS.slice(0, box.shown);
  const more = box.shown < PHONE_CARDS.length;
  return (
    <section className="phone" aria-labelledby="phone-title">
      <h2 className="section-title" id="phone-title">
        The buyer&rsquo;s phone
      </h2>
      <div className="device">
        <div className="screen">
          <div className="chat-head">
            <strong>Radar</strong>
            <span className="muted">
              {cards.length} of {PHONE_CARDS.length} finds
            </span>
          </div>
          {cards.map((card, i) => (
            <Card key={card.alertId} card={card} decision={box.decisions.get(card.alertId)} newest={i === cards.length - 1 && i > 0} />
          ))}
          <form action={nextCard} className="next-card">
            <Submit disabled={!more}>{more ? "Send the next find" : "No more finds today"}</Submit>
          </form>
        </div>
      </div>
    </section>
  );
}
