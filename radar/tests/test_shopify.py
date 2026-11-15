import httpx
import pytest

from deal_radar.sources import shopify


def test_normalize_prices_the_cheapest_in_stock_variant():
    payload = {"products": [{"id": 1, "title": " Arden Dress ", "handle": "arden", "vendor": "Kessler & Rye",
                             "variants": [
                                 {"title": "S", "price": "50.00", "compare_at_price": "200.00", "available": False},
                                 {"title": "M", "price": "80.00", "compare_at_price": "200.00", "available": True},
                                 {"title": "L", "price": "90.00", "compare_at_price": None, "available": True},
                             ]}]}
    [item] = shopify.normalize("store", "https://shop.example", payload)
    assert (item.price, item.compare_at, item.sizes_in_stock) == (80.0, 200.0, ["M", "L"])
    assert item.title == "Arden Dress" and item.url == "https://shop.example/products/arden"
    assert item.discount_pct == 60.0


def test_normalize_keeps_sold_out_items_as_unavailable():
    payload = {"products": [{"id": 2, "title": "T", "handle": "t", "variants": [
        {"title": "S", "price": "30.00", "available": False}]}]}
    [item] = shopify.normalize("store", "https://shop.example", payload)
    assert not item.available and item.price == 30.0


def test_fetch_answers_none_on_304(server):
    store = {"name": "atelier-nord", "url": f"{server.url}/atelier-nord"}
    with httpx.Client() as client:
        items, headers = shopify.fetch(client, store, {})
        assert items and headers["etag"]
        again, _ = shopify.fetch(client, store, {"If-None-Match": headers["etag"]})
    assert again is None


def test_fetch_flags_a_bot_wall(server):
    with httpx.Client() as client, pytest.raises(shopify.NotACatalogue):
        shopify.fetch(client, {"name": "glasshouse", "url": f"{server.url}/glasshouse"}, {})
