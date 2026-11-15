"""Where the comp gate gets competing offers.

`FixtureOffers` reads a JSON file keyed by search query, for the demo and the
tests. `SerperShopping` asks a Google Shopping search API, billed per query,
which is why the engine caches every answer by brand and model.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

import httpx

from ..comps import COLOURS, GENERIC, MATERIALS, fold


class OfferSource(Protocol):
    def search(self, query: str) -> list[dict[str, Any]]: ...


_NOISE = COLOURS | MATERIALS | GENERIC


def build_query(brand: str, title: str) -> str:
    """Brand, then the title's words in order minus colours, fabrics and filler.

    Specific enough to find the piece, loose enough to survive another
    retailer's name for the colourway.
    """
    words = [w for w in fold(title).split() if w not in _NOISE]
    return " ".join([fold(brand), *words[:5]]).strip()


class FixtureOffers:
    def __init__(self, path: str | Path):
        self.data: dict[str, list[dict[str, Any]]] = json.loads(Path(path).read_text())
        self.queries: list[str] = []

    def search(self, query: str) -> list[dict[str, Any]]:
        self.queries.append(query)
        return list(self.data.get(query, []))


class SerperShopping:
    URL = "https://google.serper.dev/shopping"

    def __init__(self, api_key: str, timeout: float = 20.0):
        self.api_key = api_key
        self.timeout = timeout

    def search(self, query: str) -> list[dict[str, Any]]:
        resp = httpx.post(self.URL, json={"q": query, "gl": "us"}, timeout=self.timeout,
                          headers={"X-API-KEY": self.api_key, "Content-Type": "application/json"})
        resp.raise_for_status()
        return [{"title": o.get("title", ""), "price": o.get("price"), "seller": o.get("source", "")}
                for o in resp.json().get("shopping", [])]
