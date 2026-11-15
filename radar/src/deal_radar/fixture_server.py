"""A local stand-in for real storefronts, so the demo and the tests exercise the
real HTTP path (conditional requests, 304s, a bot wall) with no network.

    /<store>/products.json   fixtures/stores/<store>/cycle-<n>.json, the newest cycle <= n
                             or wall.html (200 text/html) for a store behind a bot wall
    /feeds/<name>.xml        fixtures/feeds/<name>.xml

Every JSON body gets an ETag, and a matching If-None-Match is answered 304.
"""
from __future__ import annotations

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


class FixtureServer:
    def __init__(self, root: Path = FIXTURES, port: int = 0):
        self.root = root
        self.cycle = 1
        self.requests: list[str] = []
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - the stdlib's name
                server.requests.append(self.path)
                status, body, ctype = server.resolve(urlsplit(self.path).path)
                etag = '"' + hashlib.sha1(body).hexdigest()[:16] + '"' if status == 200 else None
                if etag and self.headers.get("If-None-Match") == etag and ctype == "application/json":
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                if etag:
                    self.send_header("ETag", etag)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: Any) -> None:
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def resolve(self, path: str) -> tuple[int, bytes, str]:
        parts = [p for p in path.split("/") if p]
        if len(parts) == 2 and parts[0] == "feeds":
            feed = self.root / "feeds" / parts[1]
            if feed.is_file():
                return 200, feed.read_bytes(), "application/rss+xml"
        if len(parts) == 2 and parts[1] == "products.json":
            store = self.root / "stores" / parts[0]
            if (store / "wall.html").is_file():
                return 200, (store / "wall.html").read_bytes(), "text/html"
            for n in range(self.cycle, 0, -1):
                f = store / f"cycle-{n}.json"
                if f.is_file():
                    return 200, f.read_bytes(), "application/json"
        return 404, b"not found", "text/plain"

    def __enter__(self) -> FixtureServer:
        self.thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
