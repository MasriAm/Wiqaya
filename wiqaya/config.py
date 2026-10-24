"""Settings, from environment variables with sensible defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass
class Settings:
    ollama_url: str = field(default_factory=lambda: _env("WIQAYA_OLLAMA_URL", "http://127.0.0.1:11434"))
    model: str = field(default_factory=lambda: _env("WIQAYA_MODEL", "gemma4:e4b-it-qat"))
    num_ctx: int = field(default_factory=lambda: int(_env("WIQAYA_NUM_CTX", "8192")))
    gemma_timeout: float = field(default_factory=lambda: float(_env("WIQAYA_GEMMA_TIMEOUT", "300")))
    data_dir: Path = field(default_factory=lambda: Path(_env("WIQAYA_DATA", str(Path.cwd() / ".wiqaya"))))
    off_url: str = field(default_factory=lambda: _env("WIQAYA_OFF_URL", "https://world.openfoodfacts.org"))
    user_agent: str = "Wiqaya/0.1 (https://github.com/MasriAm/wiqaya)"
    web_search: bool = field(default_factory=lambda: _env("WIQAYA_WEB_SEARCH", "1") != "0")
    relay_days: int = 30
    max_upload: int = 15 * 1024 * 1024
    max_message: int = 512 * 1024

    def ensure(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)


SETTINGS = Settings()
