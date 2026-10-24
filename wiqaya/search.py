"""Web search for Gemma's research tool: DuckDuckGo's lite page, with Wikipedia as a fallback.

Queries are about ingredients ("E476 source", "what is kishk"), never about a person.
"""

from __future__ import annotations

import html
import re

import httpx

from wiqaya.config import SETTINGS

_RESULT = re.compile(
    r"<a[^>]+href=\"(?P<url>[^\"]+)\"[^>]*class=['\"]result-link['\"][^>]*>(?P<title>.*?)</a>.*?"
    r"class=['\"]result-snippet['\"][^>]*>(?P<snippet>.*?)</td>",
    re.DOTALL,
)
_TAG = re.compile(r"<[^>]+>")


def _clean(s: str) -> str:
    return html.unescape(_TAG.sub("", s)).strip()


def parse_ddg_lite(page: str, n: int) -> list[dict]:
    out = []
    for m in _RESULT.finditer(page):
        url = html.unescape(m.group("url"))
        if url.startswith("//duckduckgo.com/l/?"):
            q = re.search(r"uddg=([^&]+)", url)
            url = httpx.URL("https://x/?u=" + (q.group(1) if q else "")).params.get("u", url)
        out.append({"title": _clean(m.group("title")), "url": url, "snippet": _clean(m.group("snippet"))[:300]})
        if len(out) >= n:
            break
    return out


def _wikipedia(query: str, n: int) -> list[dict]:
    with httpx.Client(timeout=10.0, headers={"User-Agent": SETTINGS.user_agent}) as c:
        r = c.get("https://en.wikipedia.org/w/api.php", params={
            "action": "query", "list": "search", "srsearch": query, "format": "json", "srlimit": n})
    r.raise_for_status()
    return [{"title": h["title"], "url": "https://en.wikipedia.org/wiki/" + h["title"].replace(" ", "_"),
             "snippet": _clean(h.get("snippet", ""))[:300]} for h in r.json().get("query", {}).get("search", [])]


def web_search(query: str, n: int = 5) -> list[dict]:
    """Up to ``n`` results: ``{"title", "url", "snippet"}``."""
    if not SETTINGS.web_search:
        return []
    query = query.strip()[:200]
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Wiqaya/0.1"}) as c:
            r = c.post("https://lite.duckduckgo.com/lite/", data={"q": query})
        if r.status_code == 200:
            results = parse_ddg_lite(r.text, n)
            if results:
                return results
    except httpx.HTTPError:
        pass
    try:
        return _wikipedia(query, n)
    except httpx.HTTPError:
        return []
