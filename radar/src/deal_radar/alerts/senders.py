"""Where cards go. The outbox always gets one; Telegram gets one when configured."""
from __future__ import annotations

import contextlib
import json
import time
from pathlib import Path
from typing import Any

import httpx


class Outbox:
    """A JSONL file per day. The source of truth for what was sent: a Telegram outage
    loses nothing."""

    def __init__(self, directory: str | Path, clock: Any = time.time):
        self.dir = Path(directory)
        self.now = clock

    def write(self, kind: str, text: str, meta: dict[str, Any] | None = None) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        day = time.strftime("%Y-%m-%d", time.gmtime(self.now()))
        line = {"at": round(self.now(), 3), "kind": kind, "text": text, **(meta or {})}
        with (self.dir / f"{day}.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")


class Telegram:
    """The raw Bot API over httpx. Sends cards with decision buttons and reads the taps."""

    def __init__(self, token: str, chat_id: str, timeout: float = 20.0):
        self.token, self.chat_id, self.timeout = token, chat_id, timeout

    @property
    def configured(self) -> bool:
        return bool(self.token and self.chat_id)

    def _call(self, method: str, http_timeout: float | None = None, **payload: Any) -> Any:
        resp = httpx.post(f"https://api.telegram.org/bot{self.token}/{method}", json=payload,
                          timeout=http_timeout or self.timeout)
        resp.raise_for_status()
        return resp.json().get("result")

    def send(self, text: str, buttons: list[tuple[str, str]] | None = None) -> bool:
        payload: dict[str, Any] = {"chat_id": self.chat_id, "text": text, "parse_mode": "HTML",
                                   "disable_web_page_preview": True}
        if buttons:
            payload["reply_markup"] = {"inline_keyboard": [[{"text": t, "callback_data": d} for t, d in buttons]]}
        try:
            self._call("sendMessage", **payload)
            return True
        except httpx.HTTPError:
            return False  # the outbox already has it

    def updates(self, offset: int, wait_seconds: int = 0) -> list[dict[str, Any]]:
        result = self._call("getUpdates", http_timeout=wait_seconds + 10, offset=offset, timeout=wait_seconds,
                            allowed_updates=["callback_query", "message"])
        return list(result or [])

    def answer(self, callback_id: str, text: str) -> None:
        if not self.configured:
            return
        with contextlib.suppress(httpx.HTTPError):
            self._call("answerCallbackQuery", callback_query_id=callback_id, text=text)
