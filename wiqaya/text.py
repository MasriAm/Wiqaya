"""Small text helpers (the phone's engine has the same splitting in web/src/engine/normalize.ts)."""

from __future__ import annotations


def split_ingredients(text: str) -> list[str]:
    """Split an ingredient list on top-level commas and semicolons; brackets stay with their ingredient."""
    out, cur, depth = [], "", 0
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if depth == 0 and ch in ",،;؛":
            if cur.strip():
                out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip().rstrip("."))
    return out
