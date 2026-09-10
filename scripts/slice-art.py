#!/usr/bin/env python3
"""
Slice the card paintings into art layers for the GameCard component.

The reference cards in public/assets/ carry their own painted frame, title and
PLAY NOW plate. The interface draws those three things itself, in HTML, so the
only part of each painting the app needs is the window of art in the middle.
This script cuts that window out and writes a WebP (served) and a PNG
(fallback) for each into public/assets/art/.

    pip install pillow
    python scripts/slice-art.py

Crop boxes are fractions of the source size, so re-exporting the paintings at
2x or 3x (please do, the current 280px sources go soft on a phone) needs no
change here — just drop the new PNGs over the old ones and re-run.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "assets"
OUT = SRC / "art"

# name -> (source file, (left, top, right, bottom) as fractions of width/height)
# Each box starts just under the painted title and stops just above the painted
# plate (or, for Coming Soon, at the bottom of the coin row).
CROPS = {
    "imposter": ("card-back-imposter.png", (0.043, 0.142, 0.957, 0.815)),
    "tictactoe": ("card-back-tictactoe.png", (0.043, 0.146, 0.957, 0.816)),
    "coming-soon": ("card-back-coming-soon.png", (0.050, 0.196, 0.950, 0.884)),
}

WEBP_QUALITY = 84


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (filename, (l, t, r, b)) in CROPS.items():
        src = SRC / filename
        if not src.exists():
            print(f"skip {name}: {src.name} not found")
            continue
        im = Image.open(src).convert("RGB")
        w, h = im.size
        box = (round(l * w), round(t * h), round(r * w), round(b * h))
        art = im.crop(box)
        webp = OUT / f"{name}.webp"
        png = OUT / f"{name}.png"
        art.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)
        art.save(png, "PNG", optimize=True)
        print(
            f"{name:12} {src.name} {w}x{h} -> {art.width}x{art.height}"
            f"  webp {webp.stat().st_size // 1024}kB  png {png.stat().st_size // 1024}kB"
        )


if __name__ == "__main__":
    main()
