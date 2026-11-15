"""The drop screen: editorial feeds scanned for collab and capsule headlines.

A keyword screen with a trigger list and a boost list. Cheap, explainable, and
good enough to put a release date in front of a person a week early.
"""
from __future__ import annotations

from collections.abc import Callable

import feedparser
import httpx

from ..models import Headline


def screen(title: str, triggers: list[str], boosts: list[str]) -> str | None:
    """The reason a headline is worth a look, or None. A trigger is required; a boost strengthens it."""
    t = title.lower()
    trigger = next((k for k in triggers if k.lower() in t), None)
    if not trigger:
        return None
    boost = next((k for k in boosts if k.lower() in t), None)
    return f"keyword: {trigger}" + (f" + {boost}" if boost else "")


def scan(client: httpx.Client, name: str, url: str, triggers: list[str], boosts: list[str],
         seen: Callable[[str], bool] = lambda _url: False) -> list[Headline] | None:
    """Fetch one feed. None when the feed itself failed (so health can be tracked);
    an empty list when it worked and nothing matched."""
    try:
        resp = client.get(url)
        resp.raise_for_status()
    except httpx.HTTPError:
        return None
    found = []
    for entry in feedparser.parse(resp.content).entries[:50]:
        link, title = str(entry.get("link", "")), str(entry.get("title", ""))
        if not link or not title or seen(link):
            continue
        reason = screen(title, triggers, boosts)
        if reason:
            found.append(Headline(feed=name, title=title, url=link, reason=reason))
    return found
