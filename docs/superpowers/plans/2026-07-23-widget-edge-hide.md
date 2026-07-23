# Widget Edge Hide — Implementation Plan

## Files

1. `src/widget-edge-hide.js` — pure geometry helpers (snap detection, expanded/collapsed positions)
2. `src/settings.js` — add `widgetEdgeHide: null | 'left' | 'right'`
3. `src/main.js` — dock on snap, collapse/expand on hover, tray menu, persist
4. `src/preload.js` / `src/renderer.js` / `src/index.html` — Hide button + hover IPC + peek styling

## Verify

- Node syntax check on all touched JS files
- Unit-style assertions on geometry helpers via `node -e`
- Optional: `npm run dist -- --linux --dir` if deps available
