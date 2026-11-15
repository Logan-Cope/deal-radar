"""Command line: `deal-radar demo | poll | listen | decide | push | probe`."""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import httpx

from . import demo
from .alerts.render import render_text
from .alerts.senders import Telegram
from .config import Config
from .engine import CycleReport, Engine, sleep_with_jitter
from .ledger import LedgerConfig
from .sources import shopify
from .sources.offers import FixtureOffers, OfferSource, SerperShopping
from .store import DB


def build_engine(config_path: str) -> Engine:
    cfg = Config.load(config_path)
    db = DB(cfg.path("db_path", "radar.db"))
    polling = cfg.section("polling")
    client = httpx.Client(headers={"User-Agent": str(polling.get("user_agent", "deal-radar/0.1"))},
                          timeout=float(polling.get("request_timeout_seconds", 20)), follow_redirects=True)
    comps = cfg.section("comps")
    offers: OfferSource | None = None
    if comps.get("source") == "fixture":
        offers = FixtureOffers(cfg.base_dir / str(comps["fixture_path"]))
    elif comps.get("source") == "serper" and os.environ.get("SERPER_API_KEY"):
        offers = SerperShopping(os.environ["SERPER_API_KEY"])
    return Engine(
        cfg, db, client, offers=offers,
        telegram=Telegram(os.environ.get("TELEGRAM_BOT_TOKEN", ""), os.environ.get("TELEGRAM_CHAT_ID", "")),
        ledger_config=LedgerConfig(os.environ.get("LEDGER_URL", ""), os.environ.get("LEDGER_TOKEN", "")),
    )


def cmd_poll(args: argparse.Namespace) -> int:
    engine = build_engine(args.config)
    polling = engine.cfg.section("polling")
    while True:
        report: CycleReport = engine.run_once()
        stamp = time.strftime("%H:%M:%S")
        for store, what in report.stores.items():
            print(f"{stamp} {store}: {what}")
        for alert_id, alert in report.carded:
            print(render_text(alert, alert_id), "\n")
        if not args.loop:
            return 0
        sleep_with_jitter(float(polling.get("interval_seconds", 300)), float(polling.get("jitter_seconds", 60)))


def cmd_decide(args: argparse.Namespace) -> int:
    engine = build_engine(args.config)
    result = engine.decide(args.alert_id, args.decision, {"name": args.name, "via": "cli"},
                           f"cli:{args.alert_id}:{args.decision}:{int(time.time())}")
    print(result)
    print(engine.push())
    return 0 if result != "unknown alert" else 1


def cmd_probe(args: argparse.Namespace) -> int:
    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        try:
            items, _ = shopify.fetch(client, {"name": "probe", "url": args.url}, {})
        except (httpx.HTTPError, shopify.NotACatalogue) as e:
            print(f"not pollable: {e}")
            return 1
    print(f"ok: {len(items or [])} products on page 1")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="deal-radar", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    d = sub.add_parser("demo", help="three cycles against local fixture stores, no keys")
    d.add_argument("--push", default="", help="dashboard URL to send the demo's buy to")
    d.add_argument("--token", default=os.environ.get("LEDGER_TOKEN", ""))

    for name, help_text in (("poll", "poll the configured stores"), ("listen", "answer Telegram taps"),
                            ("push", "send queued decisions to the ledger"), ("heartbeat", "send a heartbeat now")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--config", default="config.yaml")
        if name == "poll":
            p.add_argument("--loop", action="store_true")

    dec = sub.add_parser("decide", help="record a decision on a card from the terminal")
    dec.add_argument("alert_id", type=int)
    dec.add_argument("decision", choices=["bought", "skipped", "undo"])
    dec.add_argument("--name", default="CLI")
    dec.add_argument("--config", default="config.yaml")

    pr = sub.add_parser("probe", help="check whether a store publishes /products.json")
    pr.add_argument("url")

    args = parser.parse_args(argv)
    if args.command == "demo":
        demo.run(ledger_url=args.push, ledger_token=args.token)
        return 0
    if args.command != "probe" and not Path(args.config).is_file():
        print(f"no config at {args.config}: copy config.example.yaml first", file=sys.stderr)
        return 2
    if args.command == "poll":
        return cmd_poll(args)
    if args.command == "decide":
        return cmd_decide(args)
    if args.command == "probe":
        return cmd_probe(args)
    engine = build_engine(args.config)
    if args.command == "listen":
        if not engine.telegram.configured:
            print("set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first", file=sys.stderr)
            return 2
        engine.listen()
    elif args.command == "push":
        print(engine.push())
    elif args.command == "heartbeat":
        print(engine.heartbeat(force=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
