"""Score web/scripts/real_photos.ts against what is printed on each pack in TESTING_IMAGES (read by eye).

    uv run python bench/score_real.py bench/out/real.json
"""
import json
import sys

# contains + may contain, as printed. None: no ingredient list in the photo (nothing may be green).
TRUTH = {
    "14.54.45": (["gluten", "soy"], []),
    "14.54.45 (1)": (["gluten", "soy"], []),
    "14.54.45 (2)": (["gluten"], []),
    "14.54.46": None,
    "14.54.46 (1)": None,
    "14.54.46 (2)": (["soy"], ["milk", "tree_nuts", "peanuts"]),
    "14.54.47": (["gluten", "tree_nuts", "milk", "soy", "eggs"], ["sesame", "peanuts"]),
    "14.54.47 (1)": (["gluten", "tree_nuts", "milk", "soy", "eggs"], ["sesame", "peanuts"]),
    "14.54.47 (2)": (["gluten"], []),
    "14.54.47 (3)": (["gluten", "milk", "soy"], ["tree_nuts", "peanuts"]),
    "14.54.48": None,
    "14.56.15": None,
    "14.56.15 (1)": None,
    "14.56.16": (["gluten", "milk"], []),
    "14.56.16 (1)": (["peanuts", "soy"], ["milk", "tree_nuts", "gluten"]),
    "14.56.16 (2)": None,
    "14.56.16 (3)": ([], ["milk", "soy", "sesame", "celery"]),
    "14.56.17": None,
    "14.56.17 (1)": (["milk", "peanuts", "soy", "gluten"], []),
    "14.56.17 (2)": None,
    "14.56.17 (3)": (["gluten", "soy"], []),
    "14.56.18": (["peanuts", "milk", "gluten", "soy"], []),
    "14.56.18 (1)": (["milk", "tree_nuts", "soy"], ["peanuts", "eggs", "gluten"]),
    "14.56.18 (2)": None,
}

with open(sys.argv[1], encoding="utf-8") as fh:
    rows = {r["name"]: r for r in json.load(fh)}
tot = {"app": [0, 0, 0, 0, 0], "photo": [0, 0, 0, 0, 0]}  # flagged, present, false greens, failed, red
nolist = {"app": [0, 0], "photo": [0, 0]}
for name, truth in TRUTH.items():
    r = rows[name]
    off = r.get("off")
    off_ok = isinstance(off, dict) and "unknown_product" not in off["general"]
    views = {"photo": r["photo"], "app": off if off_ok else r["photo"]}
    line = [f"{name:13}"]
    for key, v in views.items():
        if isinstance(v, str):
            tot[key][3] += 1
            line.append(f"{key}: ERROR {v}")
            continue
        greens = set(v["greens"])
        if truth is None:
            nolist[key][1] += 1
            nolist[key][0] += not greens
            line.append(f"{key}: {'no green' if not greens else 'GREEN for ' + ','.join(sorted(greens))}")
            continue
        want = set(truth[0]) | set(truth[1])
        fg = sorted(want & greens)
        tot[key][0] += len(want - greens)
        tot[key][1] += len(want)
        tot[key][2] += len(fg)
        red = set(v["red"])
        tot[key][4] += len(want & red)
        line.append(f"{key}: {len(want - greens)}/{len(want)} flagged ({len(want & red)} red)" + (f" FALSE GREEN {fg}" if fg else ""))
    print("  ".join(line))
for key in ("app", "photo"):
    f, p, fg, err, red = tot[key]
    print(f"{key}: allergens flagged {f}/{p} ({red} red), false greens {fg}, failed requests {err}; no-list photos never green {nolist[key][0]}/{nolist[key][1]}")
