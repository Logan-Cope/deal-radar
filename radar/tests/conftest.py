from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from deal_radar.config import Config
from deal_radar.engine import Engine
from deal_radar.fixture_server import FIXTURES, FixtureServer
from deal_radar.sources.offers import FixtureOffers
from deal_radar.store import DB

RADAR = Path(__file__).resolve().parents[1]


class Clock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def db(tmp_path: Path, clock: Clock) -> DB:
    return DB(tmp_path / "radar.db", clock=clock)


@pytest.fixture
def server() -> Iterator[FixtureServer]:
    with FixtureServer(FIXTURES) as s:
        yield s


@pytest.fixture
def engine(tmp_path: Path, db: DB, server: FixtureServer) -> Iterator[Engine]:
    cfg = Config.load(RADAR / "config.demo.yaml", fixtures_url=server.url)
    cfg.data["outbox_dir"] = str(tmp_path / "outbox")
    with httpx.Client(timeout=5.0) as client:
        yield Engine(cfg, db, client, offers=FixtureOffers(RADAR / "fixtures" / "offers.json"))
