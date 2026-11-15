"""SQLite state: what each store looked like last cycle, every alert sent, the
comp cache, HTTP caching headers, store health, and the push queue."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .models import Change, Item

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    store TEXT NOT NULL,
    title TEXT NOT NULL,
    brand TEXT,
    url TEXT,
    image TEXT,
    price REAL NOT NULL,
    compare_at REAL,
    available INTEGER NOT NULL DEFAULT 1,
    sizes TEXT,
    first_seen REAL NOT NULL,
    last_seen REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    verdict TEXT NOT NULL,
    price REAL NOT NULL,
    reason TEXT,
    comp_json TEXT,           -- what the comp gate knew when the card was sent
    created_at REAL NOT NULL,
    decision TEXT,            -- 'bought' | 'skipped' | NULL while pending
    decided_at REAL,
    note TEXT
);
CREATE TABLE IF NOT EXISTS comps (
    cache_key TEXT PRIMARY KEY,
    verdict TEXT NOT NULL,
    floor REAL,
    seller TEXT,
    matches INTEGER,
    brand_offers INTEGER,
    tier TEXT,
    reason TEXT,
    checked_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS http_cache (
    url TEXT PRIMARY KEY,
    etag TEXT,
    last_modified TEXT
);
CREATE TABLE IF NOT EXISTS store_health (
    store TEXT PRIMARY KEY,
    consecutive_errors INTEGER NOT NULL DEFAULT 0,
    benched_until REAL,
    last_error TEXT
);
CREATE TABLE IF NOT EXISTS seen_headlines (
    url TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS push_queue (
    id TEXT PRIMARY KEY,      -- the event id: the ledger's idempotency key
    body TEXT NOT NULL,       -- the event as JSON, sent unchanged on every retry
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at REAL NOT NULL,
    last_error TEXT,
    parked INTEGER NOT NULL DEFAULT 0  -- 1 = the ledger rejected it; kept for a person, never resent
);
"""


class DB:
    def __init__(self, path: str | Path, clock: Any = time.time):
        self.conn = sqlite3.connect(str(path), timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.now = clock

    def _write(self, sql: str, args: tuple[Any, ...] = ()) -> sqlite3.Cursor:
        cur = self.conn.execute(sql, args)
        self.conn.commit()
        return cur

    # ---- the differ ----
    def store_item_count(self, store: str) -> int:
        row = self.conn.execute("SELECT COUNT(*) AS n FROM items WHERE store=?", (store,)).fetchone()
        return int(row["n"])

    def observe(self, item: Item) -> Change | None:
        """Record what the store shows now; return the change worth scoring, if any."""
        now = self.now()
        row = self.conn.execute("SELECT price, available FROM items WHERE id=?", (item.id,)).fetchone()
        values = (item.store, item.title, item.brand, item.url, item.image, item.price, item.compare_at,
                  int(item.available), ",".join(item.sizes_in_stock))
        if row is None:
            self._write(
                "INSERT INTO items (store, title, brand, url, image, price, compare_at, available, sizes,"
                " id, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (*values, item.id, now, now),
            )
            return Change(item=item, kind="new")
        self._write(
            "UPDATE items SET store=?, title=?, brand=?, url=?, image=?, price=?, compare_at=?, available=?,"
            " sizes=?, last_seen=? WHERE id=?",
            (*values, now, item.id),
        )
        if item.available and not row["available"]:
            return Change(item=item, kind="restock", previous_price=row["price"])
        if item.available and item.price < row["price"]:
            return Change(item=item, kind="price_drop", previous_price=row["price"])
        return None

    # ---- alerts and decisions ----
    def record_alert(self, item_id: str, kind: str, verdict: str, price: float, reason: str,
                     comp: dict[str, Any] | None) -> int:
        cur = self._write(
            "INSERT INTO alerts (item_id, kind, verdict, price, reason, comp_json, created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (item_id, kind, verdict, price, reason, json.dumps(comp) if comp else None, self.now()),
        )
        return int(cur.lastrowid or 0)

    def last_alert_price(self, item_id: str) -> float | None:
        row = self.conn.execute(
            "SELECT price FROM alerts WHERE item_id=? ORDER BY id DESC LIMIT 1", (item_id,)
        ).fetchone()
        return None if row is None else float(row["price"])

    def alert(self, alert_id: int) -> sqlite3.Row | None:
        row: sqlite3.Row | None = self.conn.execute(
            "SELECT a.*, i.store, i.brand, i.title, i.url, i.image, i.compare_at, i.sizes"
            " FROM alerts a LEFT JOIN items i ON i.id = a.item_id WHERE a.id=?",
            (alert_id,),
        ).fetchone()
        return row

    def record_decision(self, alert_id: int, decision: str | None) -> bool:
        cur = self._write("UPDATE alerts SET decision=?, decided_at=? WHERE id=?",
                          (decision, self.now() if decision else None, alert_id))
        return cur.rowcount > 0

    def record_note(self, alert_id: int, text: str) -> bool:
        cur = self._write(
            "UPDATE alerts SET note = CASE WHEN note IS NULL OR note = '' THEN ? ELSE note || ' | ' || ? END"
            " WHERE id=?",
            (text, text, alert_id),
        )
        return cur.rowcount > 0

    def alerts_since(self, seconds: float) -> int:
        row = self.conn.execute("SELECT COUNT(*) AS n FROM alerts WHERE created_at >= ?",
                                (self.now() - seconds,)).fetchone()
        return int(row["n"])

    # ---- comp cache ----
    def get_comp(self, key: str, max_age_days: float) -> sqlite3.Row | None:
        row: sqlite3.Row | None = self.conn.execute(
            "SELECT * FROM comps WHERE cache_key=? AND checked_at >= ?",
            (key, self.now() - max_age_days * 86400),
        ).fetchone()
        return row

    def save_comp(self, key: str, comp: dict[str, Any]) -> None:
        self._write(
            "INSERT OR REPLACE INTO comps (cache_key, verdict, floor, seller, matches, brand_offers, tier,"
            " reason, checked_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (key, comp["verdict"], comp.get("floor"), comp.get("seller"), comp.get("matches"),
             comp.get("brand_offers"), comp.get("tier"), comp.get("reason"), self.now()),
        )

    # ---- HTTP cache ----
    def cache_headers(self, url: str) -> dict[str, str]:
        row = self.conn.execute("SELECT etag, last_modified FROM http_cache WHERE url=?", (url,)).fetchone()
        headers: dict[str, str] = {}
        if row and row["etag"]:
            headers["If-None-Match"] = row["etag"]
        if row and row["last_modified"]:
            headers["If-Modified-Since"] = row["last_modified"]
        return headers

    def save_cache_headers(self, url: str, etag: str | None, last_modified: str | None) -> None:
        if etag or last_modified:
            self._write("INSERT OR REPLACE INTO http_cache (url, etag, last_modified) VALUES (?,?,?)",
                        (url, etag, last_modified))

    # ---- store health ----
    def store_ok(self, store: str) -> None:
        self._write(
            "INSERT INTO store_health (store, consecutive_errors) VALUES (?, 0)"
            " ON CONFLICT(store) DO UPDATE SET consecutive_errors=0, benched_until=NULL, last_error=NULL",
            (store,),
        )

    def store_error(self, store: str, error: str, bench_after: int, cooldown_minutes: float) -> bool:
        """Count a failure; bench the store once it fails `bench_after` times in a row. True if benched."""
        self._write(
            "INSERT INTO store_health (store, consecutive_errors, last_error) VALUES (?, 1, ?)"
            " ON CONFLICT(store) DO UPDATE SET consecutive_errors=consecutive_errors+1, last_error=?",
            (store, error, error),
        )
        row = self.conn.execute("SELECT consecutive_errors FROM store_health WHERE store=?", (store,)).fetchone()
        if row["consecutive_errors"] >= bench_after:
            self._write("UPDATE store_health SET benched_until=? WHERE store=?",
                        (self.now() + cooldown_minutes * 60, store))
            return True
        return False

    def benched(self, store: str) -> bool:
        row = self.conn.execute("SELECT benched_until FROM store_health WHERE store=?", (store,)).fetchone()
        return bool(row and row["benched_until"] and row["benched_until"] > self.now())

    def unhealthy(self) -> list[sqlite3.Row]:
        return list(self.conn.execute(
            "SELECT store, consecutive_errors, benched_until, last_error FROM store_health"
            " WHERE consecutive_errors > 0 ORDER BY store"
        ))

    # ---- headlines ----
    def headline_seen(self, url: str) -> bool:
        return self.conn.execute("SELECT 1 FROM seen_headlines WHERE url=?", (url,)).fetchone() is not None

    def mark_headline(self, url: str) -> None:
        self._write("INSERT OR IGNORE INTO seen_headlines (url) VALUES (?)", (url,))

    # ---- meta ----
    def get_meta(self, key: str) -> str | None:
        row = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return None if row is None else str(row["value"])

    def set_meta(self, key: str, value: str) -> None:
        self._write("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)", (key, value))

    # ---- push queue: an outbox, so a decision reaches the ledger late rather than never ----
    def enqueue(self, event: dict[str, Any]) -> bool:
        """Queue one event. Queueing the same event id twice is a no-op."""
        cur = self._write(
            "INSERT OR IGNORE INTO push_queue (id, body, next_attempt_at) VALUES (?,?,?)",
            (event["id"], json.dumps(event), self.now()),
        )
        return cur.rowcount > 0

    def due_pushes(self, limit: int) -> list[sqlite3.Row]:
        """The oldest waiting events, in queue order. Stops at the first row still backing
        off rather than skipping it, so a note never reaches the ledger before its buy."""
        due = []
        for row in self.conn.execute(
            "SELECT id, body, attempts, next_attempt_at FROM push_queue WHERE parked=0 ORDER BY rowid LIMIT ?",
            (limit,),
        ):
            if row["next_attempt_at"] > self.now():
                break
            due.append(row)
        return due

    def settle_push(self, event_id: str) -> None:
        self._write("DELETE FROM push_queue WHERE id=?", (event_id,))

    def retry_push(self, event_id: str, at: float, error: str) -> None:
        self._write("UPDATE push_queue SET attempts=attempts+1, next_attempt_at=?, last_error=? WHERE id=?",
                    (at, error, event_id))

    def park_push(self, event_id: str, error: str) -> None:
        self._write("UPDATE push_queue SET parked=1, last_error=? WHERE id=?", (error, event_id))

    def queue_stats(self) -> dict[str, int]:
        row = self.conn.execute(
            "SELECT COALESCE(SUM(parked=0),0) AS waiting, COALESCE(SUM(parked=1),0) AS parked FROM push_queue"
        ).fetchone()
        return {"waiting": int(row["waiting"]), "parked": int(row["parked"])}
