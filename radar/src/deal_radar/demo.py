"""`deal-radar demo`: three poll cycles against local fixture stores, then a person decides.

No keys, no network. Every line of output comes from the same engine that polls
real stores; only the storefronts and the offer search are fixtures.
"""
from __future__ import annotations

import tempfile
from collections.abc import Callable
from pathlib import Path

import httpx

from .config import Config
from .engine import CycleReport, Engine
from .fixture_server import FIXTURES, FixtureServer
from .ledger import LedgerConfig
from .sources.offers import FixtureOffers
from .store import DB

RADAR_DIR = Path(__file__).resolve().parents[2]


def _indent(text: str, prefix: str = "    ") -> str:
    return "\n".join(prefix + line for line in text.splitlines())


def _print_cycle(n: int, report: CycleReport, out: Callable[[str], None]) -> None:
    from .alerts.render import render_text

    out(f"\n== Cycle {n} ==")
    width = max(len(s) for s in report.stores) if report.stores else 0
    for store, what in report.stores.items():
        out(f"  {store.ljust(width)}  {what}")
    for line in report.deduped:
        out(f"  dedupe     {line}")
    for line in report.killed:
        out(f"  comp gate  {line}")
    for alert_id, alert in report.carded:
        out("")
        out(_indent(render_text(alert, alert_id)))
    for h in report.headlines:
        out(f"  drop screen  {h.title} ({h.reason})")
    if report.candidates:
        out(f"\n  {report.candidates} passed the scorer, {len(report.deduped)} deduped, "
            f"{len(report.killed)} stopped by the comp gate, {len(report.carded)} carded")


def _server(port: int) -> FixtureServer:
    try:
        return FixtureServer(FIXTURES, port=port)
    except OSError:  # the port is taken: any free one will do
        return FixtureServer(FIXTURES, port=0)


def run(out: Callable[[str], None] = print, ledger_url: str = "", ledger_token: str = "",
        port: int = 8765) -> dict[str, int]:
    with tempfile.TemporaryDirectory() as tmp, _server(port) as server:
        cfg = Config.load(RADAR_DIR / "config.demo.yaml", fixtures_url=server.url)
        cfg.data["outbox_dir"] = str(Path(tmp) / "outbox")
        db = DB(Path(tmp) / "radar.db")
        offers = FixtureOffers(RADAR_DIR / "fixtures" / "offers.json")
        client = httpx.Client(headers={"User-Agent": cfg.section("polling")["user_agent"]}, timeout=5.0)
        engine = Engine(cfg, db, client, offers=offers, ledger_config=LedgerConfig(ledger_url, ledger_token))

        out("deal-radar demo: 4 fictional stores and 1 feed served from fixtures/, no keys, no network")
        carded = 0
        for cycle in (1, 2, 3):
            server.cycle = cycle
            report = CycleReport()
            alerts = engine.comp_gate(engine.poll_stores(report), report)
            engine.dispatch(alerts, report)
            if cycle == 1:
                engine.scan_feeds(report)
            _print_cycle(cycle, report, out)
            carded += len(report.carded)

        out("\n== A person decides ==")
        first, second = 1, 2
        out(f"  Bought on #{first}: {engine.decide(first, 'bought', {'name': 'Demo', 'via': 'cli'}, 'demo:tap:1')}, "
            "a position.bought event is queued for the ledger")
        out(f"  Skip on #{second}: {engine.decide(second, 'skipped', {'name': 'Demo', 'via': 'cli'}, 'demo:tap:2')}, "
            "recorded on the alert, nothing is queued")
        summary = engine.push()
        if summary["error"]:
            out(f"  ledger push: {summary['error']}; {db.queue_stats()['waiting']} event waiting in the queue")
        else:
            statuses = ", ".join(f"{r['id']} {r['status']}" for r in summary["results"])
            out(f"  ledger push: {statuses}")

        out("\n== Heartbeat ==")
        out(_indent(engine.heartbeat(force=True) or ""))
        out(f"\nOffer lookups: {len(offers.queries)} (every later sighting of the same model came from the cache)")
        out(f"Requests to the fixture stores: {len(server.requests)}")
        client.close()
        db.conn.close()
        return {"carded": carded, "lookups": len(offers.queries)}
