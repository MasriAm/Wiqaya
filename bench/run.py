"""Benchmark, step 1: Gemma reads every synthetic label (and pairs the two lists when there is a sticker).

Results are cached per label, so a rerun only reads new labels. Every request sent to Gemma is recorded, to show
that nothing but label content goes to the model. Step 2 scores the readings with the phone's own engine:

    uv run python bench/make_labels.py --n 30 --seed 7 --out bench/out/labels
    uv run python bench/run.py bench/out/labels
    node --experimental-strip-types bench/score.ts bench/out/labels
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from wiqaya import labels
from wiqaya.gemma import Gemma
from wiqaya.images import b64, clean


class Recording(Gemma):
    """Gemma, with a log of every request's text (images are counted, not stored)."""

    def __init__(self, log: list):
        super().__init__()
        self.log = log

    def _post(self, body: dict) -> dict:
        self.log.append({"messages": [{"role": m.get("role"), "content": m.get("content"),
                                       "images": len(m.get("images") or [])} for m in body.get("messages", [])]})
        return super()._post(body)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    a = ap.parse_args()
    root = Path(a.dir)
    truth = json.loads((root / "truth.json").read_text(encoding="utf-8"))
    out = root / "facts"
    out.mkdir(exist_ok=True)
    sent: list = []
    g = Recording(sent)
    for k, case in enumerate(truth):
        dest = out / f"{case['id']}.json"
        if dest.exists():
            continue
        t0 = time.perf_counter()
        img = b64(clean((root / case["file"]).read_bytes()))
        reading, _ = labels.read(g, img)
        original, sticker, name, brand = labels.arrange([(reading, "")])
        pairs = labels.pair(g, original, sticker)[0] if original and sticker else None
        facts = {"barcode": None, "name": name, "brand": brand, "label": original, "sticker": sticker, "pairs": pairs,
                 "off": None, "suspicions": [], "seconds": round(time.perf_counter() - t0, 1)}
        dest.write_text(json.dumps(facts, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[{k + 1}/{len(truth)}] {case['id']} {facts['seconds']} s", flush=True)
    (root / "gemma_requests.json").write_text(json.dumps(sent, ensure_ascii=False, indent=1), encoding="utf-8")
    print("done", file=sys.stderr)


if __name__ == "__main__":
    main()
