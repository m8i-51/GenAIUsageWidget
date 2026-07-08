# GenAIUsageWidget

English | [日本語](README.ja.md)

A tray app / desktop widget for Windows & Linux (inspired by the macOS-only
[CodexBar](https://github.com/steipete/CodexBar)) that shows usage / rate-limit
info for the AI coding tools you're already signed into locally:

- **Claude** — session (5h), weekly, and model-scoped weekly usage
- **Codex** — primary (and, when present, weekly) rate-limit window usage
- **Cursor** — plan usage with Total / Auto / API breakdown and billing-cycle countdown
- **Antigravity (Gemini Code Assist)** — weekly quota per model group

It reads each provider's existing local session/credentials instead of asking
you to log in again, and polls their usage APIs about once a minute.

## Features

- **Glassmorphism UI** — frosted-glass cards with per-provider glow, light & dark
  mode, and meters that shift to warning/critical colors as usage climbs.
- **Two ways to view:**
  - **Tray icon** — click to open a popup near the tray; click elsewhere to dismiss.
  - **Desktop widget** — an always-on-top, draggable card pinned to the top-right
    of the screen. Toggle it from the tray icon's right-click menu.
- **Expandable cards** — click a card to reveal detailed meters (e.g. Claude's
  Session / Weekly / model-scoped Weekly; Cursor's Total / Auto / API). Cards
  with nothing extra to show simply don't expand.
- **Drag & drop reordering** — grab a card and drag it up or down; the other
  cards glide out of the way. The order is saved and restored across restarts.
- **Unconfigured providers are hidden** — no error spam for tools you don't use.
  Sign in later and the card appears automatically within a minute.
- **Rate-limit friendly** — Claude usage responses are cached and shared between
  the popup and the widget, a 429 triggers a long backoff (honoring
  `Retry-After`), and the last good snapshot is shown (with its timestamp) while
  the API is unavailable — even across app restarts.
- The window auto-sizes to its content, so the transparent widget never blocks
  clicks on what's behind it.

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
| Antigravity | Windows Credential Manager (target `gemini:antigravity`) on Windows; `~/.gemini/antigravity-cli/antigravity-oauth-token` on Linux | Requires the `agy` CLI to have been used to sign in at least once (`winget install Google.AntigravityCLI` on Windows, or the official install script on Linux). On Windows the credential is read via a small Python helper script (`src/providers/win-cred-read.py`), so Python must be on `PATH`. On Linux it's a plain JSON file, no extra dependency needed. Not yet supported on macOS. |

If a provider isn't set up, its card is hidden. If a provider is set up but its
API call fails, the card shows an error state (or, for Claude, the last
successfully fetched data marked with when it was fetched).

## Project structure

```
src/
  main.js              Electron main process: tray, popup window, widget window,
                       IPC, Claude response cache & 429 backoff
  preload.js           Exposes the get-*-usage IPC calls and window resizing
  index.html / renderer.js   Shared UI for both the popup and the widget
  providers/           One module per provider, each exporting a fetchXUsage()
                       function; not-configured.js marks "not set up" errors
assets/icon.png        Tray icon
```

## Known limitations

- Antigravity support covers Windows and Linux; macOS isn't implemented yet (Cursor/Claude/Codex are cross-platform including macOS).
- No token-refresh handling yet — if a provider's token expires, its card shows
  an error until you re-authenticate with that provider's own CLI/app.
