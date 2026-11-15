# Architecture

Two programs and one contract between them. The radar (`radar/`, Python) finds and checks deals and carries a person's decisions out. The ledger (`dashboard/`, Next.js) keeps every buy from card to sale and reads a person's notes into suggested changes. The contract is a list of events, each with an id the ledger applies exactly once.

## 1. One radar cycle

```mermaid
flowchart TD
    A[For each store] --> B{Benched?}
    B -->|yes| Z[Skip until the cooldown ends]
    B -->|no| C[GET /products.json<br/>If-None-Match from the last cycle]
    C -->|304| Y[Nothing changed]
    C -->|error or HTML bot wall| E[Count the failure<br/>bench after N in a row]
    C -->|200| D[Differ: new, price drop, restock]
    D -->|first sight of the store| BL[Baseline: record, alert nothing]
    D --> S[Scorer: watchlist bar, main bar,<br/>glitch catcher, excluded words]
    S --> DD{Dedupe: carded before<br/>and not 10% cheaper?}
    DD -->|yes| L1[Logged, not carded]
    DD -->|no| G[Comp gate]
    G --> CACHE{Floor cached for<br/>this brand and model?}
    CACHE -->|yes| RS[Re-score the floor<br/>against today's price]
    CACHE -->|no, budget left| LK[One offer search<br/>result cached]
    LK --> V[Verdict]
    RS --> V
    V -->|PASS or SCARCE| CARD[Card: outbox always,<br/>Telegram when configured]
    V -->|KILL, UNPRICED, UNKNOWN| L2[Logged with the reason]
    CARD --> HB[Daily heartbeat:<br/>stores watched, benched, queue depth]
```

| Piece | Where | What it does |
|---|---|---|
| Catalogue poller | `radar/src/deal_radar/sources/shopify.py` | Page 1 of `/products.json`, cheapest in-stock variant, sizes in stock, and a `NotACatalogue` error for a 200 that is really a bot wall |
| Differ and state | `radar/src/deal_radar/store.py` | SQLite (WAL): last-seen items, alerts and decisions, the comp cache, HTTP caching headers, store health, the push queue |
| Scorer and dedupe | `radar/src/deal_radar/scoring.py` | Config rules with accent folding; restocks skip the dedupe price check |
| Comp gate | `radar/src/deal_radar/comps.py` | Matching, the credible floor, the verdict, the thin-evidence guard |
| Offer sources | `radar/src/deal_radar/sources/offers.py` | A fixture source for the demo and tests, and a shopping search API for real use |
| Drop screen | `radar/src/deal_radar/sources/rss.py` | Keyword screen over news feeds for collab and capsule releases |
| Cards | `radar/src/deal_radar/alerts/` | One renderer for the terminal and the JSONL outbox, one for Telegram HTML with every scraped string escaped |
| Engine and CLI | `radar/src/deal_radar/engine.py`, `cli.py` | One cycle end to end, Telegram taps and replies, `demo`, `poll`, `listen`, `decide`, `push`, `probe` |
| Fixture server | `radar/src/deal_radar/fixture_server.py` | Serves the fictional stores over real HTTP with ETags, so the demo and tests exercise the real fetch path |

### The comp gate

A markdown is the seller's claim; a comp is evidence. For each find the gate searches for the same piece elsewhere and asks how far the cheapest credible offer sits above our price.

```mermaid
flowchart TD
    O[Offers from the search] --> M1{Names the brand?}
    M1 -->|no| X[Dropped]
    M1 -->|yes| M2{Men's? Other garment type?<br/>Our own store?}
    M2 -->|yes| X
    M2 -->|no| M3{Shares a model word?}
    M3 -->|yes| ST[Strong match]
    M3 -->|no| WK[Weak match:<br/>same brand and type]
    ST --> F[Floor: cheapest offer above<br/>25% of the median]
    WK -->|only if no strong ones| F
    F --> R{Floor at least 2.5x our price<br/>and $150 left after fees and shipping?}
    R -->|no| KILL[KILL]
    R -->|yes| TG{Floor 2x the cheapest brand offer<br/>on fewer than 3 matches?}
    TG -->|yes| KILL2[KILL: likely the wrong comp]
    TG -->|no| PASS[PASS]
    O --> NB{No matches at all}
    NB -->|8+ offers for the brand| SC[SCARCE: sent, marked unpriced]
    NB -->|a few| UP[UNPRICED]
    NB -->|none| UK[UNKNOWN]
```

The floor is the expensive half (a paid lookup) and stable, so it is cached by brand and model and the colourway is ignored. The ratio depends on our price, which moves, so a cached floor is re-scored every time. The demo shows both: the wrap dress is killed in cycle 2 with a live lookup and again in cycle 3 from the cache at its new price.

## 2. Getting a decision to the ledger exactly once

A tap on Bought, a tap on Undo, or a reply to a card becomes an event in the radar's SQLite push queue before anything goes over the network. The queue drains in order, 50 events per request, and only the ledger's answer settles a row.

```mermaid
sequenceDiagram
    participant P as Person
    participant R as Radar
    participant Q as Push queue (SQLite)
    participant L as Ledger /api/radar/events
    P->>R: taps Bought on card #1
    R->>Q: INSERT OR IGNORE event tg:cb:77
    R->>L: POST {events: [tg:cb:77]}
    L-->>L: applied, id recorded
    L--xR: response lost (timeout)
    Note over Q: row stays, retried in 1 min,<br/>doubling to 1 h
    R->>L: POST {events: [tg:cb:77]} again
    L-->>R: duplicate
    R->>Q: delete the row
```

| Answer | Meaning | Radar does |
|---|---|---|
| `applied` | The event changed the ledger | Deletes the row |
| `duplicate` | This id was seen before | Deletes the row |
| `stale` | The event no longer applies (an Undo after someone worked on the item) | Deletes the row |
| `rejected` | The event is malformed; the error names the field | Parks the row for a person, never resends it |
| anything else, network error, 5xx | Unknown | Keeps the row and backs off |

The queue stops at the first row still backing off instead of skipping past it, so a note can never reach the ledger before the buy it belongs to.

On the ledger side (`dashboard/lib/ledger/events.ts`):

- `position.bought` creates the item. If the alert is already in the ledger, it fills only empty fields, so a repeat never overwrites a person's edit.
- `position.removed` deletes the item only while nothing but the radar has written to it. Once a person has applied a note or added one, the undo answers `stale`.
- `position.note` attaches the reply to the item.
- Every id with a usable shape is recorded with its answer, rejected ones included, so a retry of a bad event is `duplicate` rather than a second error.

The demo shows this on screen: each tap's event and answer appears in "Events sent to the ledger", and "Send the last event again" resends the identical event to show `duplicate`.

## 3. A note becomes a suggestion

```mermaid
flowchart LR
    N[Note on an item page] --> RQ[Request: static system prompt,<br/>then the note's day, a 14-day calendar,<br/>the item as JSON, the note wrapped]
    RQ --> API[claude-opus-5-5<br/>structured output, effort low,<br/>server-side fallback on refusal]
    API -->|refusal or max_tokens| F[Failed reading, shown as such]
    API --> CH[check.ts]
    CH -->|dropped, with the reason| H[Held back list on the card]
    CH --> SG[Suggestion lines,<br/>evidence highlighted]
    SG -->|Apply ticked lines| IT[Item updated, version bumped,<br/>activity line written]
    IT -->|Undo| BK[Every field restored]
```

- **The prompt is static.** Everything about the note goes in the user message, so the system prompt is a stable prefix between notes.
- **Dates come from a calendar, not arithmetic.** The model gets the last 14 days with weekday names, so "yesterday" or "on saturday" is a lookup.
- **The checks enforce in code what the prompt asks in words** (`dashboard/lib/reader/check.ts`): the item is a candidate; the evidence is a quote from the note; a money value appears in its own evidence; a date is real, not after the note and not before the purchase; the marketplace is one the ledger tracks; nothing equal to the current value; one value per field.
- **Apply is version-checked.** A note remembers the item's version when it was read. If the item changed since, Apply is refused with a reason, and Undo is refused if a newer edit would be overwritten.
- **Tests never call the model.** The reader takes an injected `complete`; the demo and CI use fixture readings in the model's exact output shape, run through the same checks. Two fixtures carry a deliberate slip so the checks can be seen working.

## 4. Stages are derived, not stored

```mermaid
stateDiagram-v2
    [*] --> OnTheWay: bought
    OnTheWay --> Arrived: arrived date set
    Arrived --> Posted: posted date set
    Posted --> Sold: sold date set
    OnTheWay --> Sold: a sale can skip steps
    Arrived --> Sold
```

An item's stage is whichever date it has furthest along. One status line per row ("Late, was due Nov 8", "Posted Nov 6 on eBay at $395") replaces a status column and a badge. Only late items and arrivals waiting to be posted get the attention color.

## 5. Where the demo keeps its data

The public demo gives every visitor a private sandbox in server memory, keyed by a cookie and seeded fresh. Sandboxes are capped and the least recently used is dropped. A server restart resets everything. With `RADAR_TOKEN` set, the app switches to one shared ledger and enables `/api/radar/events` for a real radar. A shared ledger needs `LEDGER_PASSWORD`: the proxy asks for it with HTTP Basic, `session()` checks it again for every page and server action, the demo-only controls (the phone, the event replay, the reset) are refused, and without a password set the app answers 503 rather than serve an open ledger. The production system this is rewritten from keeps the ledger in Postgres; the event and suggestion logic is the same, which is why it lives in plain functions over a state object rather than in route handlers.
