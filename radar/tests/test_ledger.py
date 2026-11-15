import json

import httpx

from deal_radar import ledger
from deal_radar.ledger import LedgerConfig, drain

CONFIG = LedgerConfig("https://ledger.example", "secret")


class Resp:
    def __init__(self, status: int, body: object):
        self.status_code, self.body = status, body

    def json(self):
        if isinstance(self.body, str):
            raise ValueError("not json")
        return self.body


def answer(*statuses: tuple[str, str]):
    calls = []

    def post(url, json, headers, timeout):
        calls.append({"url": url, "json": json, "headers": headers})
        return Resp(200, {"results": [{"id": i, "status": s} for i, s in statuses]})

    return post, calls


def test_https_is_required_except_for_localhost():
    assert LedgerConfig("http://ledger.example", "t").problem()
    assert LedgerConfig("http://localhost:3000", "t").problem() is None
    assert LedgerConfig("", "").problem() == "not configured"


def test_settled_rows_are_deleted_and_rejected_rows_parked(db):
    for i in ("a", "b", "c"):
        db.enqueue({"id": i})
    post, calls = answer(("a", "applied"), ("b", "duplicate"), ("c", "rejected"))
    summary = drain(db, CONFIG, post=post)
    assert summary["sent"] == 3 and summary["error"] is None
    assert calls[0]["url"] == "https://ledger.example/api/radar/events"
    assert calls[0]["headers"]["Authorization"] == "Bearer secret"
    assert db.queue_stats() == {"waiting": 0, "parked": 1}


def test_network_error_keeps_rows_and_backs_off(db, clock):
    db.enqueue({"id": "a"})

    def post(*args, **kwargs):
        raise httpx.ConnectError("down")

    summary = drain(db, CONFIG, post=post, now=clock.t)
    assert "ConnectError" in summary["error"]
    assert db.queue_stats()["waiting"] == 1
    assert db.due_pushes(50) == []  # backing off for a minute
    clock.t += 61
    assert len(db.due_pushes(50)) == 1


def test_an_answer_that_is_not_the_ledgers_is_a_retry(db):
    db.enqueue({"id": "a"})
    drain(db, CONFIG, post=lambda *a, **k: Resp(502, "<html>bad gateway</html>"))
    assert db.queue_stats()["waiting"] == 1


def test_bought_event_snapshots_the_alert(db):
    from deal_radar.models import Item

    db.observe(Item(id="i1", store="harbor-and-pine", title="Tessel Field Boot", url="https://x/p",
                    price=96, brand="Orla Venn", compare_at=640))
    alert_id = db.record_alert("i1", "price_drop", "BUY", 96, "r", {"verdict": "PASS", "floor": 410})
    db.record_decision(alert_id, "bought")
    db.record_note(alert_id, "size 38")
    event = ledger.bought_event(db, alert_id, "tg:cb:1", {"name": "Sam", "via": "telegram"})
    assert event["type"] == "position.bought" and event["alert_id"] == alert_id
    assert event["position"]["paid"] == 96 and event["position"]["paid_is_sticker"] is True
    assert event["item"]["retail"] == 640 and event["comp"]["floor"] == 410
    assert event["notes"] == ["size 38"]
    json.dumps(event)  # it must serialize as sent
