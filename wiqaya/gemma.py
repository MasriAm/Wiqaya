"""Gemma 4 through Ollama: structured JSON answers, and a tool-calling loop.

* ``think: false``: label reading is perception, not reasoning; thinking is slower and adds nothing here.
* ``format``: a JSON schema per request, so the answer always parses.
* ``num_ctx``: set on every call; Ollama's default is small and truncates silently.
* temperature 0, fixed seed: the same label gives the same reading.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

import httpx

from wiqaya.config import SETTINGS


class GemmaError(RuntimeError):
    def __init__(self, message: str, text: str = ""):
        super().__init__(message)
        self.text = text  # the raw answer, when it wasn't valid JSON (for example cut short by the length limit)


class Gemma:
    def __init__(self, url: str | None = None, model: str | None = None):
        self.url = (url or SETTINGS.ollama_url).rstrip("/")
        self.model = model or SETTINGS.model

    # ------------------------------------------------------------------ status
    def status(self) -> dict:
        try:
            v = httpx.get(f"{self.url}/api/version", timeout=2.0).json().get("version")
            tags = httpx.get(f"{self.url}/api/tags", timeout=3.0).json().get("models", [])
        except (httpx.HTTPError, ValueError):
            return {"available": False, "model": self.model, "reason": "ollama_unreachable"}
        names = {m.get("name") for m in tags} | {m.get("model") for m in tags}
        if self.model not in names and f"{self.model}:latest" not in names:
            other = fallback(names)
            if not other:
                return {"available": False, "model": self.model, "ollama": v, "reason": "model_missing"}
            self.model = other  # the configured build isn't pulled, but another Gemma 4 is
        return {"available": True, "model": self.model, "ollama": v}

    def warm(self) -> float:
        t = time.perf_counter()
        self._post({"model": self.model, "stream": False, "think": False, "keep_alive": -1,
                    "messages": [{"role": "user", "content": "ok"}],
                    "options": {"num_predict": 1, "num_ctx": SETTINGS.num_ctx, "temperature": 0}})
        return time.perf_counter() - t

    # ------------------------------------------------------------------ calls
    def _post(self, body: dict) -> dict:
        try:
            r = httpx.post(f"{self.url}/api/chat", json=body, timeout=httpx.Timeout(SETTINGS.gemma_timeout, connect=5.0))
        except httpx.HTTPError as e:
            raise GemmaError(f"Gemma did not answer: {e}") from e
        if r.status_code == 404 and body.get("model") == self.model:
            # the model isn't pulled: switch to another installed Gemma 4, once
            self.status()
            if self.model != body["model"]:
                return self._post({**body, "model": self.model})
        if r.status_code != 200:
            raise GemmaError(f"Gemma returned {r.status_code}: {r.text[:300]}")
        return r.json()

    def _options(self, num_predict: int) -> dict:
        return {"temperature": 0, "seed": 42, "num_ctx": SETTINGS.num_ctx, "num_predict": num_predict}

    def json(self, system: str, user: str, schema: dict, images: list[str] | None = None,
             num_predict: int = 2048, history: list[dict] | None = None) -> tuple[dict, dict]:
        """One answer that follows ``schema``. Returns ``(answer, stats)``."""
        msg: dict[str, Any] = {"role": "user", "content": user}
        if images:
            msg["images"] = images
        body = {"model": self.model, "stream": False, "think": False, "keep_alive": -1, "format": schema,
                "messages": [{"role": "system", "content": system}, *(history or []), msg],
                "options": self._options(num_predict)}
        t = time.perf_counter()
        j = self._post(body)
        text = (j.get("message") or {}).get("content") or ""
        try:
            answer = json.loads(text)
        except json.JSONDecodeError as e:
            raise GemmaError(f"Gemma's answer was not JSON: {text[:200]}", text) from e
        return answer, _stats(j, time.perf_counter() - t)

    def run_tools(self, system: str, user: str, tools: dict[str, tuple[dict, Callable[..., Any]]],
                  max_steps: int = 6) -> tuple[list[dict], list[dict]]:
        """Let Gemma call tools until it stops (or ``max_steps``). Returns the conversation (for a final structured
        answer) and a log of the calls it made: ``[{"tool", "args", "result"}]``."""
        specs = [{"type": "function", "function": {"name": name, **spec}} for name, (spec, _) in tools.items()]
        messages: list[dict] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        log: list[dict] = []
        for _ in range(max_steps):
            j = self._post({"model": self.model, "stream": False, "think": False, "keep_alive": -1,
                            "messages": messages, "tools": specs, "options": self._options(1024)})
            msg = j.get("message") or {}
            calls = msg.get("tool_calls") or []
            messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
            if not calls:
                break
            for call in calls:
                fn = (call.get("function") or {})
                name, args = fn.get("name", ""), fn.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        args = {}
                if name not in tools:
                    result: Any = {"error": f"no tool named {name}"}
                else:
                    try:
                        result = tools[name][1](**args)
                    except Exception as e:  # noqa: BLE001  a tool failing is information for Gemma, not a crash
                        result = {"error": str(e)[:200]}
                log.append({"tool": name, "args": args, "result": result})
                messages.append({"role": "tool", "tool_name": name, "content": json.dumps(result, ensure_ascii=False)[:6000]})
        return messages[1:], log


def fallback(names: set) -> str | None:
    """Another installed Gemma 4 to use when the configured one isn't pulled: the E4B size first."""
    gemma = sorted(n for n in names if n and n.startswith("gemma4"))
    return next((n for n in gemma if n.startswith("gemma4:e4b")), gemma[0] if gemma else None)


def _stats(j: dict, wall: float) -> dict:
    return {"prompt_tokens": j.get("prompt_eval_count"), "tokens": j.get("eval_count"),
            "seconds": round(wall, 2), "load_s": round((j.get("load_duration") or 0) / 1e9, 2)}
