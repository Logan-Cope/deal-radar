"""Radar to ledger: the decisions a person makes on a card, sent to the dashboard.

Every event goes into the SQLite push queue first, so a tap made while the
dashboard is unreachable arrives late instead of never. Each event id is an
idempotency key the dashboard records, so sending one twice (a retry after a
timeout, two drains racing) is harmless: the second answer is `duplicate`.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx

from .store import DB

ENDPOINT = "/api/radar/events"
MAX_BATCH = 50
BACKOFF_BASE = 60.0
BACKOFF_MAX = 3600.0
SETTLED = ("applied", "duplicate", "stale")  # the ledger has what it needs: drop the row


@dataclass
class LedgerConfig:
    url: str = ""
    token: str = ""

    def problem(self) -> str | None:
        """Plain http only to localhost, so the bearer token never crosses a network in clear."""
        if not self.url or not self.token:
            return "not configured"
        parts = urlsplit(self.url)
        if parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1")):
            return None
        return "LEDGER_URL must be https (plain http only for localhost)"


def _instant(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat(timespec="seconds")


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).date().isoformat()


def _event(kind: str, event_id: str, actor: dict[str, str], alert_id: int, at: float) -> dict[str, Any]:
    return {"id": event_id, "type": kind, "occurred_at": _instant(at), "actor": actor, "alert_id": alert_id}


def bought_event(db: DB, alert_id: int, event_id: str, actor: dict[str, str]) -> dict[str, Any] | None:
    """A full snapshot of one buy, or None for an unknown alert."""
    row = db.alert(alert_id)
    if row is None:
        return None
    at = row["decided_at"] or row["created_at"]
    event = _event("position.bought", event_id, actor, alert_id, at)
    event["position"] = {"paid": row["price"], "paid_is_sticker": True, "bought_on": _day(at)}
    event["item"] = {
        "store": row["store"], "brand": row["brand"] or None, "title": row["title"] or f"Alert {alert_id}",
        "url": row["url"] or None, "retail": row["compare_at"],
    }
    if row["comp_json"]:
        event["comp"] = json.loads(row["comp_json"])
    notes = [n.strip() for n in (row["note"] or "").split(" | ") if n.strip()]
    if notes:
        event["notes"] = notes
    return event


def removed_event(alert_id: int, event_id: str, actor: dict[str, str], at: float) -> dict[str, Any]:
    """Undo of a buy. The dashboard deletes the item only if nobody has worked on it there."""
    return _event("position.removed", event_id, actor, alert_id, at)


def note_event(alert_id: int, event_id: str, actor: dict[str, str], text: str, at: float) -> dict[str, Any]:
    return {**_event("position.note", event_id, actor, alert_id, at), "text": text}


def _backoff(attempts: int) -> float:
    return float(min(BACKOFF_BASE * 2 ** min(attempts, 16), BACKOFF_MAX))


def drain(db: DB, config: LedgerConfig, post: Any = httpx.post, now: float | None = None) -> dict[str, Any]:
    """Send queued events in order, 50 per request. Never raises.

    applied, duplicate and stale rows are deleted; rejected rows are parked for
    a person. A network error, a 5xx or any answer that is not the ledger's
    leaves the rows and backs them off (1 minute, doubling, capped at 1 hour).
    """
    summary: dict[str, Any] = {"sent": 0, "results": [], "error": None}
    if (problem := config.problem()) is not None:
        summary["error"] = problem
        return summary
    url = config.url.rstrip("/") + ENDPOINT
    while rows := db.due_pushes(MAX_BATCH):
        t = time.time() if now is None else now
        summary["sent"] += len(rows)
        try:
            resp = post(url, json={"events": [json.loads(r["body"]) for r in rows]},
                        headers={"Authorization": f"Bearer {config.token}"}, timeout=10.0)
            data = resp.json() if resp.status_code == 200 else None
            results = {r["id"]: r for r in (data or {}).get("results", []) if isinstance(r, dict)}
            if not results:
                raise ValueError(f"HTTP {resp.status_code}")
        except Exception as e:  # network, timeout, a proxy's HTML page
            for row in rows:
                db.retry_push(row["id"], t + _backoff(row["attempts"]), str(e))
            summary["error"] = f"{e.__class__.__name__}: {e}"
            return summary
        stalled = False
        for row in rows:
            result = results.get(row["id"], {})
            status = result.get("status", "missing")
            if status in SETTLED:
                db.settle_push(row["id"])
            elif status == "rejected":
                db.park_push(row["id"], str(result.get("error") or "rejected"))
            else:  # the ledger did not settle this one: try again later, and stop for now
                db.retry_push(row["id"], t + _backoff(row["attempts"]), f"no usable result ({status})")
                stalled = True
            summary["results"].append({"id": row["id"], "status": status})
        if stalled:
            break
    return summary
