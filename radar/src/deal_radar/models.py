from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Item:
    """A normalized product observation from any source."""

    id: str  # "<source>:<store>:<product_id>"
    store: str
    title: str
    url: str
    price: float  # cheapest in-stock variant
    brand: str = ""
    image: str = ""
    compare_at: float | None = None  # the store's own "was" price, when it reports one
    available: bool = True
    sizes_in_stock: list[str] = field(default_factory=list)

    @property
    def discount_pct(self) -> float | None:
        if self.compare_at and self.compare_at > 0 and self.price < self.compare_at:
            return round(100 * (1 - self.price / self.compare_at), 1)
        return None


@dataclass
class Change:
    """What the differ saw happen to an item since the last cycle."""

    item: Item
    kind: str  # "new" | "price_drop" | "restock"
    previous_price: float | None = None


@dataclass
class Alert:
    item: Item
    kind: str
    verdict: str  # "BUY" | "WATCH"
    reason: str
    previous_price: float | None = None
    comp: dict[str, Any] | None = None  # what the comp gate knew when the card was sent


@dataclass
class Headline:
    """A flagged editorial headline from the drop screen."""

    feed: str
    title: str
    url: str
    reason: str
