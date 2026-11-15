"""One cycle: fetch, diff, score, dedupe, comp gate, card, and push decisions to the ledger.

Nothing in this file, or anywhere in this repository, can buy. The radar finds
and checks; a person decides on every card.
"""
from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import ledger
from .alerts.render import decision_buttons, render_digest, render_headline, render_heartbeat, render_html, render_text
from .alerts.senders import Outbox, Telegram
from .comps import Comp, Verdict, cache_key, describe, score_comp, verdict_from_floor
from .config import Config
from .models import Alert, Headline
from .scoring import score, should_realert
from .sources import rss, shopify
from .sources.offers import OfferSource, build_query
from .store import DB

Log = Callable[[str], None]


@dataclass
class CycleReport:
    """What one cycle did, for the terminal and the tests."""

    stores: dict[str, str] = field(default_factory=dict)  # store -> what happened
    candidates: int = 0
    deduped: list[str] = field(default_factory=list)
    killed: list[str] = field(default_factory=list)
    carded: list[tuple[int, Alert]] = field(default_factory=list)
    overflow: int = 0
    headlines: list[Headline] = field(default_factory=list)


class Engine:
    def __init__(self, cfg: Config, db: DB, client: httpx.Client, offers: OfferSource | None = None,
                 telegram: Telegram | None = None, outbox: Outbox | None = None,
                 ledger_config: ledger.LedgerConfig | None = None, post: Any = httpx.post):
        self.cfg = cfg
        self.db = db
        self.client = client
        self.offers = offers
        self.telegram = telegram or Telegram("", "")
        self.outbox = outbox or Outbox(cfg.path("outbox_dir", "outbox"), clock=db.now)
        self.ledger = ledger_config or ledger.LedgerConfig()
        self.post = post

    # ---- deal watcher ----
    def poll_stores(self, report: CycleReport) -> list[Alert]:
        polling = self.cfg.section("polling")
        bench_after = int(polling.get("error_bench_threshold", 3))
        cooldown = float(polling.get("error_cooldown_minutes", 60))
        realert_pct = float(self.cfg.section("alerts").get("realert_min_further_drop_pct", 10))
        scoring = self.cfg.section("scoring")
        fired: list[Alert] = []

        for store in self.cfg.stores:
            name = store["name"]
            if self.db.benched(name):
                report.stores[name] = "benched, skipped"
                continue
            url = shopify.products_url(store["url"])
            try:
                items, headers = shopify.fetch(self.client, store, self.db.cache_headers(url))
            except (httpx.HTTPError, shopify.NotACatalogue) as e:
                benched = self.db.store_error(name, str(e), bench_after, cooldown)
                report.stores[name] = f"error: {e}" + (" (benched)" if benched else "")
                continue
            self.db.store_ok(name)
            self.db.save_cache_headers(url, headers["etag"], headers["last_modified"])
            if items is None:
                report.stores[name] = "304 not modified"
                continue
            # The first sight of a store is a silent baseline: everything is new
            # once, and a day-one flood would teach the buyer to ignore the channel.
            baseline = self.db.store_item_count(name) == 0
            changes = [c for c in (self.db.observe(i) for i in items) if c is not None]
            if baseline:
                report.stores[name] = f"baseline, {len(items)} items recorded, no alerts"
                continue
            report.stores[name] = f"{len(items)} items, {len(changes)} changed"
            for change in changes:
                alert = score(change, scoring)
                if alert is None:
                    continue
                report.candidates += 1
                last = self.db.last_alert_price(alert.item.id)
                if not should_realert(alert, last, realert_pct):
                    drop = 100 * (1 - alert.item.price / last) if last else 0.0
                    report.deduped.append(
                        f"{alert.item.title}: carded at ${last:,.0f}, now ${alert.item.price:,.0f} "
                        f"(-{drop:.0f}%), needs -{realert_pct:.0f}% to card again")
                    continue
                fired.append(alert)
        return fired

    # ---- comp gate ----
    def _domain(self, store_name: str) -> str:
        store = next((s for s in self.cfg.stores if s["name"] == store_name), {})
        return str(store.get("domain") or urlsplit(str(store.get("url", ""))).hostname or "")

    def comp_gate(self, alerts: list[Alert], report: CycleReport) -> list[Alert]:
        """Drop the finds other sellers already list at a similar asking price. Each item is looked up once:
        the floor is cached by brand and model, and re-scored against today's price."""
        ccfg = self.cfg.section("comps")
        if not ccfg.get("enabled") or self.offers is None:
            return alerts
        max_age = float(ccfg.get("cache_days", 14))
        budget = int(ccfg.get("max_lookups_per_cycle", 60))
        spent = 0
        kept: list[Alert] = []
        for alert in alerts:
            item = alert.item
            key = cache_key(item.brand, item.title)
            cached = self.db.get_comp(key, max_age)
            if cached is not None and cached["floor"]:
                comp = verdict_from_floor(item.price, cached["floor"], cached["matches"] or 0,
                                          cached["brand_offers"] or 0, ccfg)
                comp.seller, comp.tier = cached["seller"], cached["tier"] or "model"
                comp.reason = describe(comp)
            elif cached is not None:
                comp = Comp(Verdict(cached["verdict"]), matches=cached["matches"] or 0,
                            brand_offers=cached["brand_offers"] or 0, reason=cached["reason"] or "")
            else:
                if spent >= budget:
                    # A storewide sale can clear hundreds of items at once; never
                    # turn that into hundreds of paid lookups in one cycle.
                    report.killed.append(f"{item.title}: deferred, lookup budget for this cycle spent")
                    continue
                try:
                    offers = self.offers.search(build_query(item.brand, item.title))
                    spent += 1
                except Exception as e:  # a lookup failure must not eat a find or stop the cycle
                    alert.reason += f" · comp unavailable ({e.__class__.__name__}), unverified"
                    kept.append(alert)
                    continue
                comp = score_comp({"brand": item.brand, "title": item.title, "price": item.price,
                                   "store": item.store, "store_domain": self._domain(item.store)}, offers, ccfg)
                self.db.save_comp(key, {**comp.snapshot(), "reason": comp.reason})

            alert.comp = comp.snapshot()
            if comp.verdict == Verdict.PASS:
                alert.reason += f" · {comp.reason}"
                kept.append(alert)
            elif comp.verdict == Verdict.SCARCE and ccfg.get("send_scarce", True):
                alert.reason += f" · could not price it: {comp.reason}"
                kept.append(alert)
            else:
                report.killed.append(f"{item.title}: {comp.verdict.value}, {comp.reason}")
        return kept

    # ---- cards ----
    def dispatch(self, alerts: list[Alert], report: CycleReport) -> None:
        cap = int(self.cfg.section("alerts").get("max_per_cycle", 8))
        alerts = sorted(alerts, key=lambda a: 0 if a.verdict == "BUY" else 1)  # the cap never squeezes out a BUY
        for i, alert in enumerate(alerts):
            alert_id = self.db.record_alert(alert.item.id, alert.kind, alert.verdict, alert.item.price,
                                            alert.reason, alert.comp)
            if i >= cap:
                self.outbox.write("overflow", render_text(alert, alert_id), {"alert_id": alert_id})
                report.overflow += 1
                continue
            self.outbox.write("alert", render_text(alert, alert_id), {"alert_id": alert_id})
            if self.telegram.configured:
                self.telegram.send(render_html(alert), decision_buttons(alert_id))
            report.carded.append((alert_id, alert))
        if report.overflow:
            self.outbox.write("digest", render_digest(report.overflow))
            if self.telegram.configured:
                self.telegram.send(render_digest(report.overflow))

    # ---- drop screen ----
    def scan_feeds(self, report: CycleReport) -> None:
        screen = self.cfg.section("drop_screen")
        for feed in self.cfg.feeds:
            found = rss.scan(self.client, feed["name"], feed["url"], screen.get("triggers") or [],
                             screen.get("boosts") or [], seen=self.db.headline_seen)
            for h in found or []:
                self.db.mark_headline(h.url)
                self.outbox.write("headline", render_headline(h))
                report.headlines.append(h)

    def heartbeat(self, force: bool = False, interval_hours: float = 24.0) -> str | None:
        last = float(self.db.get_meta("last_heartbeat") or 0)
        if not force and self.db.now() - last < interval_hours * 3600:
            return None
        benched = [r["store"] for r in self.db.unhealthy() if self.db.benched(r["store"])]
        text = render_heartbeat(len(self.cfg.stores), benched, self.db.alerts_since(86400), self.db.queue_stats())
        self.outbox.write("heartbeat", text)
        if self.telegram.configured:
            self.telegram.send(text)
        self.db.set_meta("last_heartbeat", str(self.db.now()))
        return text

    # ---- decisions ----
    def decide(self, alert_id: int, decision: str, actor: dict[str, str], event_id: str) -> str:
        """A person tapped Bought, Skip or Undo on a card. Record it and queue the ledger event."""
        if decision not in ("bought", "skipped", "undo"):
            return "unknown decision"
        if self.db.alert(alert_id) is None:
            return "unknown alert"
        if decision == "undo":
            self.db.record_decision(alert_id, None)
            self.db.enqueue(ledger.removed_event(alert_id, event_id, actor, self.db.now()))
            return "undone"
        self.db.record_decision(alert_id, decision)
        if decision == "bought":
            event = ledger.bought_event(self.db, alert_id, event_id, actor)
            if event:
                self.db.enqueue(event)
        return decision

    def handle_update(self, update: dict[str, Any]) -> str | None:
        """One Telegram update: a button tap (`dec:<alert>:<decision>`) or a reply that becomes a note.

        Only updates from the configured chat count. A bot can be added to any
        chat, and a tap from a stranger's chat must not record a buy.
        """
        cb = update.get("callback_query")
        chat = ((cb or {}).get("message") or update.get("message") or {}).get("chat", {}).get("id")
        if not self.telegram.chat_id or str(chat) != str(self.telegram.chat_id):
            return None
        if cb:
            parts = str(cb.get("data", "")).split(":")
            if len(parts) != 3 or parts[0] != "dec" or not parts[1].isdigit():
                return None
            actor = {"name": str(cb.get("from", {}).get("first_name") or "Telegram"), "via": "telegram"}
            result = self.decide(int(parts[1]), parts[2], actor, f"tg:cb:{cb.get('id')}")
            self.telegram.answer(str(cb.get("id")), f"Logged: {result}")
            return result
        msg = update.get("message") or {}
        replied = (msg.get("reply_to_message") or {}).get("reply_markup") or {}
        buttons = [b for row in replied.get("inline_keyboard", []) for b in row]
        alert_ids = {str(b.get("callback_data", "")).split(":")[1] for b in buttons
                     if str(b.get("callback_data", "")).startswith("dec:")}
        if len(alert_ids) == 1 and msg.get("text"):
            alert_id = int(alert_ids.pop())
            self.db.record_note(alert_id, msg["text"])
            actor = {"name": str(msg.get("from", {}).get("first_name") or "Telegram"), "via": "telegram"}
            self.db.enqueue(ledger.note_event(alert_id, f"tg:msg:{msg.get('chat', {}).get('id')}:"
                                              f"{msg.get('message_id')}", actor, msg["text"], self.db.now()))
            return "noted"
        return None

    def listen(self, wait_seconds: int = 50) -> None:
        """Long-poll Telegram so a tap is answered at once. Runs until interrupted."""
        offset = int(self.db.get_meta("telegram_offset") or 0)
        while True:
            for update in self.telegram.updates(offset, wait_seconds):
                offset = max(offset, int(update["update_id"]) + 1)
                self.handle_update(update)
                self.db.set_meta("telegram_offset", str(offset))
            self.push()

    def push(self) -> dict[str, Any]:
        return ledger.drain(self.db, self.ledger, post=self.post)

    def run_once(self) -> CycleReport:
        report = CycleReport()
        alerts = self.poll_stores(report)
        alerts = self.comp_gate(alerts, report)
        self.dispatch(alerts, report)
        self.scan_feeds(report)
        self.heartbeat()
        self.push()
        return report


def sleep_with_jitter(base: float, jitter: float) -> None:  # pragma: no cover
    import random

    time.sleep(base + random.uniform(0, jitter))
