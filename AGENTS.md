# AGENTS.md

## Cursor Cloud specific instructions

GenAIUsageWidget is a single **Electron** desktop app (tray icon + always-on-top
desktop widget) that reads locally-stored AI-provider credentials and shows their
usage/rate-limit meters. It is plain JavaScript (CommonJS), uses **npm** (Node 20 in
CI; newer Node works for dev), and has **no backend service, no database server, no
lint step, and no automated tests**. See `README.md` and `package.json` for the
authoritative command list.

### Commands
- Install: `npm install` (or `npm ci`). This is the only setup needed and is the update-script step.
- Run (dev): `npm start` (runs `electron .`). This is a **GUI app** — it needs a display.
- Package check (what CI runs): `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist -- --linux --dir`
  (`--dir` skips building real installers). CI is `.github/workflows/ci.yml`.
- Lint / test: none exist.

### Running the GUI in the cloud VM (non-obvious)
- A display is already available at `DISPLAY=:1`; `npm start` renders the widget in
  the top-right corner and works with the `computerUse` subagent for screenshots/video.
- On launch you will see harmless `Failed to connect to the bus` (D-Bus) and
  `Exiting GPU process` errors in the log — these are expected in the headless
  container and do not stop the app from rendering.
- `npm start` runs in the foreground and does not detach; run it in a `tmux` session
  if you need the shell back while keeping the app alive.

### Demonstrating usage cards without real credentials (non-obvious)
- With no provider signed in, every card is hidden and the widget shows
  "No AI providers detected on this machine" — this is correct behavior, not a bug.
- Each provider module in `src/providers/*.js` exports a `fetchXUsage()` that reads a
  local credential file and calls that provider's real HTTPS API, so real cards
  require a real login. To demo the card UI without credentials, temporarily make a
  provider's fetch function return sample `usage` data (matching the shape consumed in
  `src/renderer.js`), then revert before committing.
