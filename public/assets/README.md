# Design assets

## What is here

| File | Role |
|---|---|
| `Imposter_GPT.png`, `tictactoe_GPT.png`, `Draft_GPT.png` | **The card designs.** Reference and art direction, and the source the key art is cut from. Not loaded by the app. |
| `logo.png` | **Source logo.** Not loaded by the app; the vector version lives in `src/ui/brand/`. |
| `art/*.webp`, `art/*.png` | **Key art.** The middle of each card design, sliced by `scripts/slice-art.py`. This is what `GameCard` renders. |

Each card design is a finished thing: title, eyebrow, key art, Play Now pill.
The interface draws the title, the eyebrow, the player count and the pill
itself in HTML, in that game's own accent, so changing any of them never means
re-exporting a picture. Only the key art in the middle is an image.

The crops also cut past the flavour text painted down the left edge of two of
the cards. Nothing the interface shows as text comes out of a picture.

## When you re-export

- Keep the same composition; the slice script uses fractional crop boxes, so a
  bigger export of the same design slices identically.
- Then run `python scripts/slice-art.py` (needs `pip install pillow`).
- It writes a WebP at 720px wide, which is what the app serves, plus a
  palette-quantised PNG that only a browser too old for WebP would ever fetch.

The logo is already a vector (`src/ui/brand/logo.svg` and `mark.svg`), traced
from `logo.png`. Both take `currentColor`, so the mark is white in the nav bar
and gold on a card back. If the logo changes, hand over an SVG and replace
those two files; `mark.svg` is the same drawing cropped to the 9.
