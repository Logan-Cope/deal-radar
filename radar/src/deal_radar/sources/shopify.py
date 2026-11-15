"""Shopify storefronts publish their catalogue at /products.json, logged out.

One polite request per store per cycle: page 1 (the 250 newest products), an
honest User-Agent, and conditional headers so an unchanged store answers 304.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..models import Item

PAGE_LIMIT = 250


class NotACatalogue(Exception):
    """HTTP 200 with something other than a product feed, usually a bot wall's HTML."""


def products_url(base_url: str, page: int = 1) -> str:
    return f"{base_url.rstrip('/')}/products.json?limit={PAGE_LIMIT}&page={page}"


def _price(variant: dict[str, Any]) -> float:
    try:
        return float(variant.get("price") or 0)
    except (TypeError, ValueError):
        return 0.0


def normalize(store_name: str, base_url: str, payload: dict[str, Any]) -> list[Item]:
    """Turn a /products.json payload into Items.

    Price is the cheapest in-stock variant (the cheapest of all when none is in
    stock), and sizes are the option titles of the variants in stock.
    """
    items: list[Item] = []
    for product in payload.get("products", []):
        variants = product.get("variants") or []
        in_stock = [v for v in variants if v.get("available")]
        priced = [v for v in (in_stock or variants) if _price(v) > 0]
        if not priced:
            continue
        cheapest = min(priced, key=_price)
        try:
            compare_at = float(cheapest.get("compare_at_price") or 0) or None
        except (TypeError, ValueError):
            compare_at = None
        images = product.get("images") or []
        items.append(Item(
            id=f"shopify:{store_name}:{product.get('id')}",
            store=store_name,
            title=str(product.get("title", "")).strip(),
            brand=str(product.get("vendor") or "").strip(),
            url=f"{base_url.rstrip('/')}/products/{product.get('handle', '')}",
            image=images[0].get("src", "") if images else "",
            price=_price(cheapest),
            compare_at=compare_at,
            available=bool(in_stock),
            sizes_in_stock=[str(v.get("title", "")) for v in in_stock],
        ))
    return items


def fetch(client: httpx.Client, store: dict[str, Any], cache_headers: dict[str, str]
          ) -> tuple[list[Item] | None, dict[str, str | None]]:
    """Fetch page 1 of a store. Returns (items, caching headers); items is None on 304.

    Raises httpx.HTTPError on a failed request and NotACatalogue on a 200 that
    is not a product feed, so the engine can count the failure and bench the store.
    """
    resp = client.get(products_url(store["url"]), headers={"Accept": "application/json", **cache_headers})
    headers = {"etag": resp.headers.get("ETag"), "last_modified": resp.headers.get("Last-Modified")}
    if resp.status_code == 304:
        return None, headers
    resp.raise_for_status()
    try:
        payload = resp.json()
    except ValueError as e:
        raise NotACatalogue("200 but not JSON (bot wall?)") from e
    if not isinstance(payload, dict) or "products" not in payload:
        raise NotACatalogue("200 but no products key")
    return normalize(store["name"], store["url"], payload), headers
