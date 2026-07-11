# v149 — consolidated cartographic runtime

## Why this release is different

Versions 147–148 tried to repair labels and layer switches by adding final guards to the accumulated application code. That was not sufficient: labels still depended indirectly on Leaflet marker state, while hover, selection, visibility and drawing order continued to be controlled by several generations of wrappers.

v149 introduces a separate `map-runtime-v149.js` and assigns one owner to the fragile live-map subsystems.

## Rebuilt subsystems

### 1. Labels

- Administrative labels are plain DOM elements in `#atlasLabelOverlayV149`.
- City labels use the same overlay and collision field.
- No `Tooltip`, `DivIcon`, invisible marker or Leaflet label layer is required.
- Administrative labels do not depend on polygon visibility.
- City labels do not depend on point visibility.
- There is no hard minimum zoom.
- Density and font-size controls remain live.
- A health row shows candidate and visible label counts.

### 2. Layer visibility

- `refreshVisibility()` now delegates to one deterministic visibility manager.
- Legacy Leaflet label layers are always removed.
- Hydrography, ATE polygons, ATE-1 mask/outline, railways, centers, population circles and analytical overlays have explicit rules.
- Layer drawing order is applied in one place.

### 3. Hover and selection

- Polygon and point hover use one custom cursor-following card.
- Polygon event handlers are rebound after every administrative-layer rebuild.
- Cursor, rectangle and polygon tools are controlled by one selection engine.
- Rectangle selection uses real geometry intersection; polygon mode supports Enter, Escape and Backspace.
- Selection styling and hover styling are composed in one visual-state function.
- Enter and Space work on focusable administrative polygons.

### 4. Maintainability

- The new runtime is isolated from the historical analytical/export code.
- Future fixes to live-map interaction should be made in `map-runtime-v149.js`, not as another appended wrapper in `app.js`.

## Files changed

- `index.html`
- `app.js` — version only
- `style.css`
- `data/manifest.json`
- `map-runtime-v149.js` — new
