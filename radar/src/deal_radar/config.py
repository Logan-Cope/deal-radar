from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class Config:
    data: dict[str, Any]
    base_dir: Path
    env: dict[str, str] = field(default_factory=lambda: dict(os.environ))

    @classmethod
    def load(cls, path: str | Path, fixtures_url: str = "") -> Config:
        """Read a YAML config. `{fixtures}` in a URL is replaced with the local fixture server."""
        p = Path(path)
        text = p.read_text().replace("{fixtures}", fixtures_url.rstrip("/"))
        return cls(yaml.safe_load(text) or {}, p.parent)

    def path(self, key: str, default: str) -> Path:
        value = Path(str(self.data.get(key, default)))
        return value if value.is_absolute() else self.base_dir / value

    def section(self, key: str) -> dict[str, Any]:
        return dict(self.data.get(key) or {})

    @property
    def stores(self) -> list[dict[str, Any]]:
        return [s for s in self.data.get("stores") or [] if s.get("active", True)]

    @property
    def feeds(self) -> list[dict[str, Any]]:
        return list(self.data.get("feeds") or [])
