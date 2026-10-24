"""Wiqaya's server: the web app, Gemma, Open Food Facts and the family relay.

Privacy by construction: no endpoint accepts a name, an allergy profile or a location. The server learns which
products are scanned and the label photos (cleaned, never stored); the phone alone matches them against people.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from wiqaya import __version__, labels, menus, off
from wiqaya.config import SETTINGS
from wiqaya.gemma import Gemma, GemmaError
from wiqaya.images import BadImage, b64, clean
from wiqaya.relay import Relay, RelayError

log = logging.getLogger("wiqaya")
WEB = Path(__file__).parent / "web_dist"


class ResearchIn(BaseModel):
    ingredients: list[str] = Field(max_length=20)
    product_name: str | None = None


class Finding(BaseModel):
    trigger: str
    quote: str


class ExplainIn(BaseModel):
    findings: list[Finding] = Field(max_length=30)
    lang: str = "en"


class MessageIn(BaseModel):
    body: str


def create_app(gemma: Gemma | None = None, relay: Relay | None = None, cache: off.Cache | None = None) -> FastAPI:
    app = FastAPI(title="Wiqaya", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    state = {"gemma": gemma or Gemma(), "relay": relay, "cache": cache}

    def g() -> Gemma:
        return state["gemma"]

    def the_relay() -> Relay:
        if state["relay"] is None:
            state["relay"] = Relay()
        return state["relay"]

    def the_cache() -> off.Cache:
        if state["cache"] is None:
            state["cache"] = off.Cache()
        return state["cache"]

    @app.get("/api/health")
    def health() -> dict:
        return {"version": __version__, "gemma": g().status(), "web_search": SETTINGS.web_search}

    @app.get("/api/product/{barcode}")
    def product(barcode: str) -> dict:
        if not off.valid_barcode(barcode):
            raise HTTPException(400, "bad_barcode")
        try:
            p = off.fetch(barcode, the_cache())
        except (httpx.HTTPError, ValueError) as e:  # Open Food Facts unreachable: the phone falls back to a photo
            log.warning("open food facts: %s", type(e).__name__)
            raise HTTPException(503, "product_lookup_failed") from e
        if not p:
            raise HTTPException(404, "not_found")
        return off.to_facts(p)

    @app.post("/api/scan")
    async def scan(photos: Annotated[list[UploadFile], File()], hints: Annotated[list[str] | None, Form()] = None,
                   barcode: Annotated[str, Form()] = "") -> dict:
        """Label photos (and the barcode, if it was read) → ProductFacts."""
        if not 1 <= len(photos) <= 3:
            raise HTTPException(400, "one_to_three_photos")
        t0 = time.perf_counter()
        images = []
        for photo in photos:
            data = await photo.read(SETTINGS.max_upload + 1)
            if len(data) > SETTINGS.max_upload:
                raise HTTPException(413, "photo_too_large")
            try:
                images.append(b64(clean(data)))
            except BadImage as e:
                raise HTTPException(400, "not_an_image") from e
        hints = ((hints or []) + [""] * len(images))[: len(images)]
        try:
            # Gemma and the network run in a worker thread: the server keeps answering the family relay meanwhile
            readings = [await run_in_threadpool(labels.read, g(), img, hint) for img, hint in zip(images, hints)]
        except GemmaError as e:
            raise HTTPException(503, "gemma_unavailable") from e
        original, sticker, name, brand = labels.arrange([(r, h) for (r, _), h in zip(readings, hints)])
        pairs = None
        if original and sticker:
            try:
                pairs, _ = await run_in_threadpool(labels.pair, g(), original, sticker)
            except GemmaError:
                pairs = None  # the engine says "not compared" (amber)
        facts = {"barcode": None, "name": name, "brand": brand, "label": original, "sticker": sticker,
                 "pairs": pairs, "off": None, "suspicions": []}
        if barcode and off.valid_barcode(barcode):
            facts["barcode"] = barcode
            try:
                p = await run_in_threadpool(off.fetch, barcode, the_cache())
            except (httpx.HTTPError, ValueError):
                p = None
            if p:
                known = off.to_facts(p)
                facts["off"] = known["off"]
                facts["name"] = facts["name"] or known["name"]
                facts["brand"] = facts["brand"] or known["brand"]
                if not facts["label"]:
                    facts["label"] = known["label"]
        facts["seconds"] = round(time.perf_counter() - t0, 1)
        return facts

    @app.post("/api/menu")
    async def menu(url: Annotated[str, Form()] = "", files: Annotated[list[UploadFile] | None, File()] = None) -> dict:
        """A restaurant menu (a link, up to four photos, or a PDF) → its dishes and what each is usually made with.
        Nothing about the family is sent; the phone matches the dishes against each person."""
        t0 = time.perf_counter()
        text, images = "", []
        try:
            if url.strip():
                data, kind = await run_in_threadpool(menus.fetch, url.strip())
                text, images = await run_in_threadpool(menus.parts_of, data, kind)
            for f in (files or [])[: menus.MAX_PAGES]:
                data = await f.read(SETTINGS.max_upload + 1)
                if len(data) > SETTINGS.max_upload:
                    raise menus.MenuError("too_large")
                t, imgs = await run_in_threadpool(menus.parts_of, data, (f.content_type or "").lower())
                text += ("\n" + t) if t else ""
                images += imgs
        except menus.MenuError as e:
            raise HTTPException(400, e.code) from e
        if not text.strip() and not images:
            raise HTTPException(400, "nothing_to_read")
        try:
            out = await run_in_threadpool(menus.read, g(), text, images)
        except GemmaError as e:
            raise HTTPException(503, "gemma_unavailable") from e
        if not out["dishes"]:
            raise HTTPException(422, "no_dishes")
        out["seconds"] = round(time.perf_counter() - t0, 1)
        return out

    @app.post("/api/expiry")
    async def expiry(photo: Annotated[UploadFile, File()]) -> dict:
        """A photo of the epinephrine pen's box → the expiry date printed on it, for the reminder."""
        data = await photo.read(SETTINGS.max_upload + 1)
        if len(data) > SETTINGS.max_upload:
            raise HTTPException(413, "photo_too_large")
        try:
            image = b64(clean(data))
        except BadImage as e:
            raise HTTPException(400, "not_an_image") from e
        try:
            return await run_in_threadpool(labels.expiry, g(), image)
        except GemmaError as e:
            raise HTTPException(503, "gemma_unavailable") from e

    @app.post("/api/research")
    def research(body: ResearchIn) -> dict:
        try:
            suspicions, tool_log = labels.research(g(), body.ingredients, body.product_name)
        except GemmaError as e:
            raise HTTPException(503, "gemma_unavailable") from e
        return {"suspicions": suspicions, "tools_used": [{"tool": c["tool"], "args": c["args"]} for c in tool_log]}

    @app.post("/api/explain")
    def explain(body: ExplainIn) -> dict:
        return {"items": labels.explain(g(), [f.model_dump() for f in body.findings], body.lang)}

    @app.post("/api/circle/{circle}")
    def post_message(circle: str, body: MessageIn) -> dict:
        try:
            return the_relay().post(circle, body.body)
        except RelayError as e:
            raise HTTPException(400, str(e)) from e

    @app.get("/api/circle/{circle}")
    def get_messages(circle: str, after: int = 0) -> dict:
        try:
            return {"messages": the_relay().since(circle, after)}
        except RelayError as e:
            raise HTTPException(400, str(e)) from e

    @app.exception_handler(HTTPException)
    async def _err(_req, exc: HTTPException):
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    if (WEB / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

        @app.get("/{path:path}")
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "not_found")
            f = (WEB / path).resolve()
            if path and f.is_file() and WEB.resolve() in f.parents:
                # the service worker must be fetched fresh, or a phone keeps an old app
                return FileResponse(f, headers={"Cache-Control": "no-cache"} if path == "sw.js" else None)
            return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})

    @app.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(self), geolocation=(self), microphone=()"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    return app
