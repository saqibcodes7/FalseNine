# Design assets

## What is here

| File | Role |
|---|---|
| `card-back-imposter.png`, `card-back-tictactoe.png`, `card-back-coming-soon.png` | **Source paintings.** Reference art and art direction. Not loaded by the app. |
| `logo.png` | **Source logo.** Not loaded by the app; the vector version lives in `src/ui/brand/`. |
| `art/*.webp`, `art/*.png` | **Art layers.** The middle window of each painting, sliced by `scripts/slice-art.py`. This is what `GameCard` renders. |

The interface draws every frame, title, plate and badge itself in HTML and CSS.
The paintings only ever appear as the art inside a frame the app has drawn, so
changing text, state or size never means re-exporting an image.

## When you re-export

The current sources are about 280px wide, which goes soft on a phone screen
where the featured card renders at 300+ CSS px at 2x or 3x density.

- Export the three card paintings at **2x or 3x** (at least 600px wide).
- Keep the same composition; the slice script uses fractional crop boxes, so a
  larger export of the same picture slices identically.
- Then run `python scripts/slice-art.py` (needs `pip install pillow`).

The logo is already a vector (`src/ui/brand/logo.svg` and `mark.svg`), traced
from `logo.png`. If the logo changes, hand over an SVG and replace those two
files; `mark.svg` is the same drawing with its viewBox cropped to the 9.
