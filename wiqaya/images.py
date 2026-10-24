"""Label photos: decoded, turned upright, shrunk, and re-encoded from the pixels alone, so no EXIF, GPS or device
data survives. Only the cleaned image ever reaches Gemma, and it is never written to disk."""

from __future__ import annotations

import base64
import io

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_SIDE = 1600


class BadImage(ValueError):
    pass


def clean(data: bytes, max_side: int = MAX_SIDE) -> bytes:
    """A new JPEG built from the pixels only."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise BadImage("not an image") from e
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    fresh = Image.new("RGB", img.size)
    fresh.paste(img)
    out = io.BytesIO()
    fresh.save(out, format="JPEG", quality=90, optimize=True)
    return out.getvalue()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
