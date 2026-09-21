#!/usr/bin/env python3
"""
Slice the game key art out of the card designs for the GameCard component.

The cards in public/assets/ are complete designs: title, eyebrow, key art and
a Play Now pill. The interface draws the title, eyebrow and pill itself in
HTML, so the only part it needs is the key art in the middle. This cuts that
out and writes a WebP (served) and a PNG (fallback) into public/assets/art/.

    pip install pillow
    python scripts/slice-art.py

Crop boxes are fractions of the source size, so re-exporting a card at a
different resolution needs no change here — drop the new PNG over the old one
and re-run. Each box is chosen to land near square, which is the shape of the
art window on the featured card, and to exclude the vertical flavour text
painted down the left edge of two of the cards (the interface never renders
text from a picture).
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "assets"
OUT = SRC / "art"

# name -> (source file, (left, top, right, bottom) as fractions of width/height)
CROPS = {
    "imposter": ("Imposter_GPT.png", (0.212, 0.190, 0.945, 0.690)),
    "tictactoe": ("tictactoe_GPT.png", (0.060, 0.180, 0.940, 0.768)),
    "draft": ("Draft_GPT.png", (0.222, 0.190, 0.945, 0.712)),
}

WEBP_QUALITY = 82
MAX_WIDTH = 720  # sharp on a 350pt card at 2x, and still a small download


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (filename, (l, t, r, b)) in CROPS.items():
        src = SRC / filename
        if not src.exists():
            print(f"skip {name}: {src.name} not found")
            continue
        im = Image.open(src).convert("RGB")
        w, h = im.size
        art = im.crop((round(l * w), round(t * h), round(r * w), round(b * h)))
        if art.width > MAX_WIDTH:
            art = art.resize(
                (MAX_WIDTH, round(art.height * MAX_WIDTH / art.width)),
                Image.LANCZOS,
            )
        webp = OUT / f"{name}.webp"
        png = OUT / f"{name}.png"
        art.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)
        # The PNG is only ever fetched by a browser too old for WebP, so it is
        # palette-quantised: a fraction of the bytes, no visible difference at
        # the size these render.
        art.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG).save(
            png, "PNG", optimize=True
        )
        print(
            f"{name:12} {src.name} {w}x{h} -> {art.width}x{art.height}"
            f"  webp {webp.stat().st_size // 1024}kB  png {png.stat().st_size // 1024}kB"
        )


if __name__ == "__main__":
    main()
