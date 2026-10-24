"""The family circle's relay: it stores messages it cannot read.

Phones encrypt every message with the family key (AES-GCM, from the invite QR code) before sending it. The relay
keeps the encrypted text, the circle's random id and a time, nothing else, and deletes messages after 30 days.
"""

from __future__ import annotations

import re
import sqlite3
import threading
import time
from pathlib import Path

from wiqaya.config import SETTINGS

CIRCLE_ID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
# what an encrypted message looks like on the wire: base64url pieces joined by dots (iv.ciphertext)
BODY = re.compile(r"^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){1,3}$")


class RelayError(ValueError):
    pass


class Relay:
    def __init__(self, path: Path | None = None):
        SETTINGS.ensure()
        self.path = path or SETTINGS.data_dir / "relay.sqlite"
        self._lock = threading.Lock()
        with self._db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, circle TEXT, at REAL, body TEXT)")
            db.execute("CREATE INDEX IF NOT EXISTS by_circle ON messages (circle, id)")

    def _db(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def post(self, circle: str, body: str) -> dict:
        if not CIRCLE_ID.match(circle):
            raise RelayError("bad circle id")
        if len(body) > SETTINGS.max_message or not BODY.match(body):
            raise RelayError("bad message")
        now = time.time()
        with self._lock, self._db() as db:
            cur = db.execute("INSERT INTO messages (circle, at, body) VALUES (?, ?, ?)", (circle, now, body))
            db.execute("DELETE FROM messages WHERE at < ?", (now - SETTINGS.relay_days * 86400,))
            return {"id": cur.lastrowid, "at": now}

    def since(self, circle: str, after: int = 0, limit: int = 200) -> list[dict]:
        if not CIRCLE_ID.match(circle):
            raise RelayError("bad circle id")
        with self._lock, self._db() as db:
            rows = db.execute("SELECT id, at, body FROM messages WHERE circle = ? AND id > ? ORDER BY id LIMIT ?",
                              (circle, after, limit)).fetchall()
        return [{"id": r[0], "at": r[1], "body": r[2]} for r in rows]
