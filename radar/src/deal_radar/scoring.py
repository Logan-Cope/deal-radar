"""The first gate: is this change worth a second look?

Rules only, all from config. The comp gate (comps.py) asks the harder question
afterwards; this one exists so the comp gate only pays for plausible finds.
"""
from __future__ import annotations

import unicodedata
from typing import Any

from .models import Alert, Change


def fold(text: str) -> str:
    """Lowercase and strip accents, so a watchlist entry "orla venn" matches "Orla Vénn"."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def score(change: Change, cfg: dict[str, Any]) -> Alert | None:
    """Decide whether a change is alert-worthy, and how loudly.

    - items under ignore_below_price are data noise
    - exclude_keywords kill (gift cards, samples)
    - watchlist brands pass at watchlist_min_discount_pct, as BUY
    - any brand passes at min_discount_pct, as BUY
    - an item with no "was" price passes under max_price_absolute, as WATCH:
      the glitch catcher, for a store that forgot to set a list price
    """
    item = change.item
    if not item.available or item.price < float(cfg.get("ignore_below_price", 1.0)):
        return None

    haystack = fold(f"{item.title} {item.brand}")
    if any(fold(kw) in haystack for kw in cfg.get("exclude_keywords") or []):
        return None

    discount = item.discount_pct
    on_watchlist = any(fold(b) in haystack for b in cfg.get("watchlist_brands") or [])
    min_discount = float(cfg.get("min_discount_pct", 70))
    watchlist_min = float(cfg.get("watchlist_min_discount_pct", 60))
    max_abs = float(cfg.get("max_price_absolute", 40))

    def alert(verdict: str, reason: str) -> Alert:
        return Alert(item=item, kind=change.kind, verdict=verdict, reason=reason,
                     previous_price=change.previous_price)

    if on_watchlist and discount is not None and discount >= watchlist_min:
        return alert("BUY", f"watchlist brand at -{discount:.0f}%")
    if discount is not None and discount >= min_discount:
        return alert("BUY", f"-{discount:.0f}% off")
    # The glitch catcher only applies when the discount is unknown. When it is
    # known, the bars above are the whole answer: a cheap item at a shallow
    # discount is priced normally. Without this restriction the catcher quietly
    # re-admits everything the discount bar just rejected.
    if discount is None and item.price <= max_abs and change.kind in ("new", "price_drop"):
        return alert("BUY" if on_watchlist else "WATCH",
                     f"${item.price:.0f} with no list price (possible pricing error)")
    return None


def should_realert(alert: Alert, last_alert_price: float | None, min_further_drop_pct: float) -> bool:
    """Dedupe: an item already carded is carded again only if it fell meaningfully further.

    Restocks skip the price check. An item back in stock at the same price is
    exactly what the buyer missed the first time.
    """
    if alert.kind == "restock" or last_alert_price is None:
        return True
    if last_alert_price <= 0:
        return False
    drop = 100 * (1 - alert.item.price / last_alert_price)
    return drop >= min_further_drop_pct
