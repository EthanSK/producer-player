#!/usr/bin/env python3
from pathlib import Path
import sys

try:
    from PIL import Image
except Exception:
    print("Pillow is required. Install with: python3 -m pip install pillow", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    ROOT / "site/assets/screenshots/app-hero.png",
    ROOT / "site/assets/screenshots/app-hero-checklist.png",
    ROOT / "site/assets/screenshots/app-hero-readme.png",
]
OUT_DIR = ROOT / "artifacts/app-store-connect/screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PAD_BG = (15, 17, 24)


def pad_to_1440x900(img: Image.Image) -> Image.Image:
    if img.size == (1440, 900):
        return img.copy()

    if img.size[0] != 1440:
        h = round(img.size[1] * (1440 / img.size[0]))
        img = img.resize((1440, h), Image.Resampling.LANCZOS)

    out = Image.new("RGB", (1440, 900), PAD_BG)
    y = (900 - img.size[1]) // 2
    out.paste(img.convert("RGB"), (0, y))
    return out


missing = [source for source in SOURCES if not source.exists()]
if missing:
    print("Missing screenshot source files:", file=sys.stderr)
    for item in missing:
        print(f"- {item}", file=sys.stderr)
    sys.exit(1)

for source in SOURCES:
    base = source.stem.replace("app-hero", "producer-player")
    src = Image.open(source)

    out_1440 = pad_to_1440x900(src)
    out_1440.save(OUT_DIR / f"{base}-1440x900.png", format="PNG", optimize=True)

    out_1280 = out_1440.resize((1280, 800), Image.Resampling.LANCZOS)
    out_1280.save(OUT_DIR / f"{base}-1280x800.png", format="PNG", optimize=True)

print(f"Generated screenshots in: {OUT_DIR}")
