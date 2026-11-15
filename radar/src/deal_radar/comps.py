"""The comp gate: is this actually cheap, or just marked down?

A discount is the seller's claim. A comp is evidence: other sellers' current
asking prices for the same piece. For each find this module answers one
question, *what is the cheapest price anyone else asks for this same thing
today*, and turns the answer into a verdict. Asking prices, not sold prices.

It is deliberately not a profit model. Headroom is the gap to the cheapest
competing listing after fees and shipping, not a prediction of what an item
will sell for.

Matching is the whole risk. Fetching prices is easy; knowing two listings are
the same garment is where this lives or dies, and each filter below exists
because leaving it out produced a wrong answer.
"""
from __future__ import annotations

import re
import statistics
import unicodedata
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

Offer = dict[str, Any]


class Verdict(StrEnum):
    PASS = "PASS"          # cheap, and nobody else is close
    KILL = "KILL"          # findable elsewhere at a similar price
    SCARCE = "SCARCE"      # the brand sells widely online, this exact piece does not
    UNPRICED = "UNPRICED"  # too few genuine matches to trust a floor
    UNKNOWN = "UNKNOWN"    # the brand has no online footprint at all


@dataclass
class Comp:
    verdict: Verdict
    floor: float | None = None
    seller: str | None = None
    ratio: float | None = None
    headroom: float | None = None
    matches: int = 0
    brand_offers: int = 0
    tier: str = "model"
    reason: str = ""

    def snapshot(self) -> dict[str, Any]:
        """What rides on the alert and, later, on the ledger item."""
        def r(v: float | None) -> float | None:
            return None if v is None else round(v, 2)

        return {
            "verdict": self.verdict.value, "floor": r(self.floor), "seller": self.seller,
            "ratio": r(self.ratio), "headroom": r(self.headroom), "matches": self.matches,
            "brand_offers": self.brand_offers, "tier": self.tier,
        }


def fold(text: str) -> str:
    """Lowercase, strip accents and punctuation, and read '&' as 'and'.

    The ampersand matters: one retailer writes "Kessler & Rye" where another
    writes "Kessler and Rye", and treating those as two brands loses every comp.
    """
    decomposed = unicodedata.normalize("NFKD", str(text).lower().replace("&", " and "))
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", stripped)).strip()


ITEM_TYPES = {
    "boot", "bootie", "sandal", "heel", "pump", "loafer", "sneaker", "mule", "clog", "shoe",
    "bag", "tote", "clutch", "purse", "crossbody", "hobo", "satchel", "backpack", "wallet",
    "dress", "gown", "skirt", "trouser", "pant", "jean", "short", "legging", "coat", "jacket",
    "blazer", "parka", "trench", "bomber", "vest", "cardigan", "sweater", "knit", "turtleneck",
    "hoodie", "top", "shirt", "blouse", "tee", "tank", "scarf", "belt", "hat", "jumpsuit",
}
# Colours and materials are not identity: "black" would match half a catalogue.
COLOURS = {
    "black", "white", "ivory", "beige", "brown", "blue", "green", "red", "pink", "grey", "gray",
    "silver", "gold", "navy", "cream", "khaki", "multi", "olive", "rust", "sand", "stone",
    "indigo", "charcoal", "burgundy", "caramel", "ecru", "dark", "light", "pale", "washed",
    "tan", "ink", "oat", "clay", "espresso", "sage", "chalk", "camel",
}
MATERIALS = {
    "cotton", "wool", "silk", "linen", "cashmere", "denim", "satin", "velvet", "lace", "leather",
    "jersey", "crepe", "twill", "poplin", "nylon", "mesh", "suede", "canvas", "tweed", "ribbed",
}
GENERIC = {
    "the", "and", "with", "for", "in", "of", "women", "womens", "mini", "midi", "maxi", "long",
    "short", "sleeve", "high", "low", "rise", "detail", "print", "printed", "cropped",
    "oversized", "new", "style", "fit", "neck", "waist", "back", "front", "piece", "size",
}
BRAND_NOISE = {"by", "the", "and", "de", "of", "studio", "atelier"}

_MENS = re.compile(r"\b(men s|mens|men|homme|uomo)\b")
_PRICE = re.compile(r"[\d,]+\.?\d*")


def _sing(word: str) -> str:
    """Crude singulariser, applied to both the vocabularies and the titles so they line up."""
    return word[:-1] if word.endswith("s") and len(word) > 3 else word


ITEM_TYPES_S = {_sing(t) for t in ITEM_TYPES}
STOPWORDS_S = {_sing(w) for w in ITEM_TYPES | COLOURS | MATERIALS | GENERIC}


def _words(title: str) -> set[str]:
    return {_sing(w) for w in fold(title).split()}


def to_price(value: Any) -> float | None:
    """Search APIs return '$1,150.00'; fixtures return floats. Accept both."""
    if isinstance(value, int | float):
        return float(value) if value > 0 else None
    found = _PRICE.search(str(value or ""))
    if not found:
        return None
    try:
        price = float(found.group(0).replace(",", ""))
    except ValueError:
        return None
    return price if price > 0 else None


def brand_keys(brand: str) -> list[str]:
    """Fingerprints for a brand, most distinctive first: the whole name squashed,
    then its longest meaningful word ("Marlow Atelier" -> "marlowatelier", "marlow")."""
    words = fold(brand).split()
    if not words:
        return []
    keys = ["".join(words)]
    for w in sorted((w for w in words if w not in BRAND_NOISE and len(w) > 2), key=len, reverse=True):
        if w not in keys:
            keys.append(w)
    return keys


def brand_matches(brand: str, folded_title: str) -> bool:
    squashed = folded_title.replace(" ", "")
    return any(k in squashed for k in brand_keys(brand))


def item_types(title: str) -> list[str]:
    return sorted(t for t in ITEM_TYPES_S if t in _words(title))


def model_tokens(title: str) -> list[str]:
    """The words that identify the piece: not its colour, fabric or garment type.

    Numbers stay ("Field Boot 60" carries the model in its digits).
    """
    return sorted(w for w in _words(title)
                  if w not in STOPWORDS_S and (len(w) > 2 or (w.isdigit() and len(w) >= 2)))


def cache_key(brand: str, title: str) -> str:
    """Identity for the comp cache: brand plus model words, ignoring the colourway.

    Retail titles run "<Model> <Type> <Colourway>". Colourway names are
    unbounded ("TIDE STRIPE"), but everything before the garment type is the
    model, so the same shirt in two colours costs one lookup.
    """
    words = fold(title).split()
    types = set(item_types(title))
    head = words
    for i, w in enumerate(words):
        if _sing(w) in types:
            head = words[:i]
            break
    tokens = sorted({_sing(x) for x in head} - STOPWORDS_S)
    tokens = [t for t in tokens if len(t) > 2 and not t.isdigit()]
    keys = brand_keys(brand)
    return " ".join(([keys[0]] if keys else []) + tokens) or fold(f"{brand} {title}")


def is_own_store(item: dict[str, Any], seller: str) -> bool:
    """Is this offer the very store we found the item at?

    Scoped to the item being priced, never global: a store we buy from still
    sets floors for every other item. The identity comes from the store's
    domain in config, so a newly added store excludes itself on day one.
    """
    seller_key = fold(seller).replace(" ", "")
    if len(seller_key) < 4:  # a one-letter seller is a substring of everything
        return False
    domain = str(item.get("store_domain") or "")
    stem = domain.split("//")[-1].split("/")[0].split(".")[0]
    stem = fold(stem).replace(" ", "") or fold(str(item.get("store", ""))).replace(" ", "")
    if len(stem) < 4:
        return False
    return stem in seller_key or seller_key in stem


def match_offers(item: dict[str, Any], offers: list[Offer]) -> list[Offer]:
    """Keep only offers that are plausibly the same item, with `_price` and `_tier` attached."""
    brand = item.get("brand", "")
    wanted_types = item_types(item.get("title", ""))
    wanted_model = model_tokens(item.get("title", ""))

    strong: list[Offer] = []
    weak: list[Offer] = []
    for offer in offers:
        title = fold(offer.get("title", ""))
        words = _words(title)
        price = to_price(offer.get("price"))
        if price is None:
            continue
        if brand and not brand_matches(brand, title):
            continue
        if _MENS.search(title):
            continue
        if wanted_types and not any(t in words for t in wanted_types):
            continue
        if is_own_store(item, str(offer.get("seller") or "")):
            continue
        if wanted_model and any(m in words for m in wanted_model):
            strong.append({**offer, "_price": price, "_tier": "model"})
        else:
            weak.append({**offer, "_price": price, "_tier": "brand+type"})
    # Same brand and garment type but a different model is weak evidence. It
    # still beats refusing to price the item, and the tier rides on the card.
    return strong or weak


def brand_offer_prices(item: dict[str, Any], offers: list[Offer]) -> list[float]:
    """Every offer that names the brand at all: proof the search works for this label,
    and the cheapest one sanity-checks the floor."""
    brand = item.get("brand", "")
    if not brand:
        return []
    prices = [to_price(o.get("price")) for o in offers if brand_matches(brand, fold(o.get("title", "")))]
    return sorted(p for p in prices if p is not None)


def floor_of(matched: list[Offer]) -> tuple[float, str]:
    """Cheapest credible offer.

    A lone listing far below the pack is junk or a mislabel, not a comp. The cut
    is gentle on purpose (25% of the median): an aggressive cut deletes the
    correct cheap match and invents headroom that is not there.
    """
    ordered = sorted(matched, key=lambda o: o["_price"])
    cut = 0.25 * statistics.median(o["_price"] for o in ordered)
    best = next((o for o in ordered if o["_price"] >= cut), ordered[0])
    return float(best["_price"]), str(best.get("seller") or "")


def verdict_from_floor(price: float, floor: float, matches: int, brand_n: int, cfg: dict[str, Any]) -> Comp:
    """Score a known floor against today's price.

    Split out because the floor is the expensive half (a paid lookup) and is
    stable, while the ratio moves with our price. A verdict cached at $200 must
    not be reused when the item drops to $100: that is when the answer changes.
    """
    ratio = floor / price if price > 0 else 0.0
    fee_rate = float(cfg.get("fee_rate", 0.136))
    headroom = floor * (1 - fee_rate) - float(cfg.get("shipping", 18.0)) - price
    ok = ratio >= float(cfg.get("min_ratio", 2.5)) and headroom >= float(cfg.get("min_headroom", 150.0))
    return Comp(verdict=Verdict.PASS if ok else Verdict.KILL, floor=floor, ratio=ratio,
                headroom=headroom, matches=matches, brand_offers=brand_n)


def score_comp(item: dict[str, Any], offers: list[Offer], cfg: dict[str, Any]) -> Comp:
    """Turn a pile of competing offers into one verdict."""
    matched = match_offers(item, offers)
    brand_prices = brand_offer_prices(item, offers)
    brand_n = len(brand_prices)

    if len(matched) < int(cfg.get("min_matches", 1)):
        # Calling a piece scarce asserts a negative. That is only credible when
        # the search demonstrably works for the brand: a wall of offers for the
        # label and none for the piece. A few stray hits mean an obscure brand,
        # which says nothing about scarcity.
        if brand_n >= int(cfg.get("scarce_min_brand_offers", 8)):
            return Comp(Verdict.SCARCE, matches=0, brand_offers=brand_n,
                        reason=f"{brand_n} offers for the brand, none for this piece")
        return Comp(Verdict.UNKNOWN if brand_n == 0 else Verdict.UNPRICED, matches=len(matched),
                    brand_offers=brand_n, reason=f"only {len(matched)} genuine matches, not enough to price")

    floor, seller = floor_of(matched)
    comp = verdict_from_floor(float(item["price"]), floor, len(matched), brand_n, cfg)
    comp.seller = seller
    comp.tier = matched[0].get("_tier", "model")

    # Thin-evidence guard: when the floor towers over the cheapest same-brand
    # offer and almost nothing backs it, the floor is the outlier, not the deal.
    gap = float(cfg.get("outlier_guard_gap", 2.0))
    min_n = int(cfg.get("outlier_guard_min_matches", 3))
    cheapest_brand = brand_prices[0] if brand_prices else None
    if comp.verdict == Verdict.PASS and cheapest_brand and len(matched) < min_n and floor >= gap * cheapest_brand:
        comp.verdict = Verdict.KILL
        comp.reason = (f"${floor:,.0f} at {seller} is {floor / cheapest_brand:.0f}x the cheapest "
                       f"{item.get('brand') or 'brand'} offer (${cheapest_brand:,.0f}) on only "
                       f"{len(matched)} match{'es' if len(matched) != 1 else ''}, likely the wrong comp")
        return comp

    comp.reason = describe(comp)
    return comp


def describe(comp: Comp) -> str:
    """The comp line on the card. It says "cheapest found", never "cheapest anywhere":
    a shopping index only sees what merchants submit to it, so the floor is a lower bound."""
    seller = comp.seller or "another store"
    n = f"{comp.matches} comp{'s' if comp.matches != 1 else ''}"
    qual = "" if comp.tier == "model" else ", same brand not same model"
    if comp.verdict == Verdict.PASS:
        return f"cheapest found ${comp.floor:,.0f} at {seller}, {comp.ratio:.1f}x our price ({n}{qual})"
    room = comp.headroom or 0.0
    headroom = f"-${-room:,.0f}" if room < 0 else f"${room:,.0f}"
    return f"${comp.floor:,.0f} at {seller} is only {comp.ratio:.1f}x, {headroom} headroom ({n}{qual})"
