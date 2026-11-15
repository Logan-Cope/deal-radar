from deal_radar.models import Alert, Change, Item
from deal_radar.scoring import fold, score, should_realert

CFG = {
    "min_discount_pct": 70, "watchlist_brands": ["Orla Venn"], "watchlist_min_discount_pct": 60,
    "max_price_absolute": 40, "ignore_below_price": 1, "exclude_keywords": ["gift card"],
}


def item(price: float, compare: float | None = None, brand: str = "Vantor", title: str = "Keel Trouser",
         available: bool = True) -> Item:
    return Item(id="x", store="s", title=title, url="u", price=price, brand=brand, compare_at=compare,
                available=available)


def test_fold_strips_accents():
    assert fold("Orla Vénn") == "orla venn"


def test_watchlist_brand_passes_at_its_lower_bar():
    alert = score(Change(item(200, 500, brand="Orla Vénn"), "price_drop"), CFG)
    assert alert and alert.verdict == "BUY" and "watchlist" in alert.reason


def test_other_brands_need_the_main_bar():
    assert score(Change(item(200, 500), "price_drop"), CFG) is None  # -60% is not -70%
    assert score(Change(item(140, 500), "price_drop"), CFG).verdict == "BUY"


def test_excluded_keywords_and_noise_prices_never_alert():
    assert score(Change(item(5, 100, title="Store Gift Card"), "new"), CFG) is None
    assert score(Change(item(0.5), "new"), CFG) is None


def test_sold_out_items_never_alert():
    assert score(Change(item(10, 500, available=False), "new"), CFG) is None


def test_glitch_catcher_only_when_the_discount_is_unknown():
    assert score(Change(item(30), "new"), CFG).verdict == "WATCH"
    # A known, shallow discount is normal pricing even when the price is low.
    assert score(Change(item(30, 40), "new"), CFG) is None


def test_glitch_catcher_ignores_restocks():
    assert score(Change(item(30), "restock"), CFG) is None


def _alert(kind: str, price: float) -> Alert:
    return Alert(item(price, 500), kind, "BUY", "r")


def test_dedupe_needs_a_meaningful_further_drop():
    assert should_realert(_alert("price_drop", 100), None, 10)
    assert not should_realert(_alert("price_drop", 95), 100, 10)
    assert should_realert(_alert("price_drop", 89), 100, 10)


def test_restocks_bypass_dedupe():
    assert should_realert(_alert("restock", 100), 100, 10)
