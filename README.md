# codex-tray-bar

A tray app (inspired by [CodexBar](https://github.com/steipete/CodexBar)) that shows
usage/rate-limit info for AI coding tools you're already signed into locally:

- **Claude** — session (5h) and weekly usage
- **Codex** — primary rate-limit window usage
- **Cursor** — plan usage and billing-cycle countdown
- **Antigravity (Gemini Code Assist)** — weekly quota per model group

It reads each provider's existing local session/credentials instead of asking you
to log in again, and polls their usage APIs once a minute.

Two ways to view it:

- **Tray icon** — click to open a popup near the tray, click elsewhere to dismiss.
- **Desktop widget** — an always-on-top, draggable card pinned to the top-right of
  the screen. Toggle it from the tray icon's right-click menu.

## Setup

```
npm install
npm start
```

## Where each provider's credentials come from

| Provider | Source | Notes |
|---|---|---|
| Claude | `~/.claude/.credentials.json` | Written by the Claude Code CLI on login |
| Codex | `~/.codex/auth.json` | Written by the `codex` CLI (`npm i -g @openai/codex`, then `codex login`) |
| Cursor | Cursor app's `state.vscdb` (SQLite, via `sql.js`) | Requires the Cursor desktop app to be installed and signed in |
| Antigravity | Windows Credential Manager, target `gemini:antigravity` | Requires the `agy` CLI (`winget install Google.AntigravityCLI`) to have been used to sign in at least once. **Windows only** — reads the credential via a small Python helper script (`src/providers/win-cred-read.py`), so Python must be on `PATH`. |

If a provider isn't set up, its card shows an error/loading state rather than
crashing the app.

## Project structure

```
src/
  main.js              Electron main process: tray, popup window, widget window, IPC
  preload.js           Exposes the get-*-usage IPC calls to the renderer
  index.html / renderer.js   Shared UI for both the popup and the widget
  providers/           One module per provider, each exporting a fetchXUsage() function
assets/icon.png        Tray icon
```

## Known limitations

- Antigravity support is Windows-only for now (Cursor/Claude/Codex are cross-platform).
- No token-refresh handling yet — if a provider's token expires, its card just shows
  an error until you re-authenticate with that provider's own CLI/app.
