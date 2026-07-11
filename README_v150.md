# v150 — cartographic label styling cleanup

## Main changes

- Administrative labels are now rendered without white background plaques.
- The label style is more map-like: text with a soft halo instead of a boxed chip.
- City / point labels are now pure text labels without the small red dot glyph.
- Dark theme label styling was adapted to the same no-plaque approach.
- `APP_VERSION`, `index.html` asset query strings and `data/manifest.json` were updated to v150.

## Files changed

- `style.css`
- `map-runtime-v149.js`
- `index.html`
- `app.js`
- `data/manifest.json`
