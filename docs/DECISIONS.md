# Decisions

The calls that shaped this design, with what was given up for each.

## Nothing can buy on its own

**Decision:** the radar finds, checks and carries decisions. A person taps every buy. There is no checkout code anywhere in the repository, and no setting that adds one.

**Why:** automated checkout is where account bans, chargebacks and anti-bot law live, and the margin on a good find does not need a bot's speed. The expensive mistake in resale is buying the wrong thing, not buying a minute late. A card that arrives with the evidence attached makes the human decision fast enough.

**Given up:** the fastest-sellout items. That is accepted.

## A comp gate, not a bigger discount bar

**Decision:** a find has to clear two bars. First the store's own discount, then the market: the cheapest credible offer elsewhere must be at least 2.5x our price and leave $150 after fees and shipping.

**Why:** a markdown is the seller's claim. A 75% discount on something sold everywhere at that price is not a deal. Raising the discount bar does not fix that; it only makes the channel quieter while still letting through the same false positives. When the channel is too quiet, the ratio and headroom bars are the ones to loosen.

**Given up:** money per lookup and some recall. Each lookup costs a fraction of a cent, so floors are cached by brand and model, and a cycle has a lookup budget. A thin-evidence guard kills some real deals to stop a single towering listing from inventing headroom.

## "Scarce" is a verdict, not a failure

**Decision:** when a brand has plenty of offers online but this exact piece has none, the card is still sent, marked as unpriced.

**Why:** the absence of a match is only meaningful when the search demonstrably works for the brand. A wall of offers for the label and none for the piece is exactly the pattern behind the best finds. A handful of stray hits means an obscure brand, which says nothing, so that case is `UNPRICED` and not sent.

## The first sight of a store is silent

**Decision:** cycle one records everything and alerts nothing.

**Why:** every item is "new" the first time. A day-one flood of 250 cards teaches the person to ignore the channel, and a channel people ignore is worse than no channel.

## A heartbeat exists

**Decision:** once a day the radar sends a summary: stores watched, stores benched, alerts in the last 24 hours, and the ledger queue depth.

**Why:** from the phone, a broken radar and a quiet week look identical. Silence has to mean "nothing worth buying", never "the poller died on Tuesday".

## The outbox and the push queue are the source of truth

**Decision:** every card goes to a JSONL outbox before any chat message, and every decision goes to a SQLite queue before any request.

**Why:** a chat API outage or a dashboard deploy must not lose a find or a buy. Writing locally first and delivering later turns every network failure into a delay instead of a loss.

## Idempotent events, answered one by one

**Decision:** each event carries an id the ledger records with its answer. The ledger answers every event in a batch separately: `applied`, `duplicate`, `stale` or `rejected`.

**Why:** retries are inevitable (timeouts, two drains racing), so applying twice has to be harmless. Per-event answers let the radar settle what landed, park what was malformed, and keep only the unknowns.

## Undo respects work done since

**Decision:** an Undo from the phone deletes the item only while nothing but the radar has written to it.

**Why:** the phone and the ledger are two places to act on the same item. If someone has already applied a note to it in the ledger, a late tap on Undo must not erase that work. The undo answers `stale` and the item stays.

## Every note gets a reading, nothing writes without a tap

**Decision:** a note is read into suggestions automatically, but nothing changes until a person ticks lines and taps Apply. One Undo reverses a whole Apply.

**Why:** reading every note removes a decision the person should not have to make, and the tap keeps the model from ever writing on its own. Changes the model was unsure of start unticked.

## Copy, never compute

**Decision:** money comes from the note as written ("payout 309.12"), never from fee arithmetic. Every change carries a verbatim quote, and code drops a change whose amount is not in its own quote.

**Why:** a model that computes a payout from a fee table will be confidently wrong when the fee table changes. A model that copies can be checked by a string search.

## The eval came before the reader

**Decision:** the reader's cases, including negatives (a question, a store's promise, an injection attempt), were written first, with a gate of precision 1.0 and recall 0.9.

**Why:** precision is the number that matters to the person. A missed change costs a tap; a wrong one, applied by habit, corrupts the ledger. The gate says which trade to make.

## The demo is event-sourced in the visitor's browser

**Decision:** the public demo keeps each visitor's history as a list of actions in their own cookie, and the server rebuilds their ledger from the seed on every request. No write endpoint is exposed.

**Why:** a shared demo would show one visitor another's notes, and free text from strangers is not something to display to the next person. The first version kept a sandbox per visitor in server memory, which worked locally and failed on Vercel, where consecutive requests land on different instances: an Undo reached an instance that had never seen the buy. Replaying a short action log through the same functions the forms use makes every instance agree without a database.

**Given up:** history length. A cookie holds about 4 KB, so a visitor can take a few dozen actions before the demo asks for a reset.

## Not in this repository

The production system this was rewritten from has a few things left out here on purpose: real store integrations beyond the generic catalogue poller, photo uploads on notes, and a server-side fetch that prefills an item from a pasted product link. That fetch is guarded against private-network addresses in production, but a public demo that fetches arbitrary URLs is a liability with no upside, so it was not ported.
