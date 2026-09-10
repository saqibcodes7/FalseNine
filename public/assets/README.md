# Design assets

Drop your exported PNGs in here. Section 7 of the build spec:

- Export at **2x or 3x** the display size so they stay sharp on phone screens.
- Use **transparent backgrounds** for anything that sits over other art
  (card backs, badges, pack icons) rather than flattening onto white.
- These get run through web compression (WebP with a PNG fallback) as a build
  step before launch, so hand over the full-quality exports rather than
  pre-compressing them yourself.

Suggested structure once the assets land:

```
public/assets/
  card-backs/     card-back-default.png, card-back-imposter.png
  packs/          premier-league.png, champions-league.png, world-cup.png
  ui/             logo.png, badge-coming-soon.png
```

Reference them from components as `/assets/card-backs/card-back-default.png`.
Anything in `public/` is served from the site root as-is.
