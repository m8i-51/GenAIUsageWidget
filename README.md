# GenAIUsageWidget

English | [日本語](README.ja.md)

Cross-platform tray app / desktop widget tracking AI coding provider usage limits (inspired by macOS [CodexBar](https://github.com/steipete/CodexBar)).

A separate Windows & Linux project — not a port, not affiliated, and not a drop-in replacement.

<p align="center">
  <img src="docs/screenshots/widget-flyout.png" alt="Desktop widget docked to the right edge, with circular usage rings and a Claude detail flyout" width="380">
  &nbsp;&nbsp;
  <img src="docs/screenshots/tray-popup.png" alt="Tray popup with usage cards for Claude, Codex, Copilot, Antigravity, Gemini, and Cursor" width="230">
</p>
<p align="center"><sub>Widget (left), tray popup (right). Demo data (<code>GENAI_USAGE_DEMO=1</code>).</sub></p>

## Downloads

Latest release **[v2026.9.1-a551105](https://github.com/m8i-51/GenAIUsageWidget/releases/tag/v2026.9.1-a551105)** — [all releases](https://github.com/m8i-51/GenAIUsageWidget/releases):

- **Windows** — [GenAIUsageWidget.Setup.2026.9.1-a551105.exe](https://github.com/m8i-51/GenAIUsageWidget/releases/download/v2026.9.1-a551105/GenAIUsageWidget.Setup.2026.9.1-a551105.exe)
- **Linux** — [GenAIUsageWidget-2026.9.1-a551105.AppImage](https://github.com/m8i-51/GenAIUsageWidget/releases/download/v2026.9.1-a551105/GenAIUsageWidget-2026.9.1-a551105.AppImage) · [genai-usage-widget_2026.9.1-a551105_amd64.deb](https://github.com/m8i-51/GenAIUsageWidget/releases/download/v2026.9.1-a551105/genai-usage-widget_2026.9.1-a551105_amd64.deb)

The Windows `.exe` is unsigned. SmartScreen may warn on first launch: choose **More info**, then **Run anyway**. See [Known limitations](#known-limitations). Build from source under [Setup](#setup).

## Who this is for

- Windows and Linux users who want Claude, Codex, Copilot, Gemini, and Cursor remaining quota visible without opening dashboards.

Shows usage / rate-limit info for the AI coding tools you're already signed into locally:

- **Claude** — session (5h), weekly, and model-scoped weekly usage
- **Codex** — primary (and, when present, weekly) rate-limit window usage
- **Copilot** — monthly Premium request and Chat quota usage (via your GitHub Copilot CLI sign-in)
- **Cursor** — plan usage with Total / Auto / API breakdown, Grok Bot weekly allowance when available, and billing-cycle countdown
- **Antigravity (Gemini Code Assist)** — weekly quota per model group
- **Gemini CLI** — daily Pro and Flash model quota (via your Gemini CLI Google sign-in)
- **Windsurf** — daily and weekly quota (or prompt credits / flow actions on older plans)
- **Kiro** — monthly credits, plus bonus or overage credits when present

It reads each provider's existing local session/credentials instead of asking
you to log in again, and polls their usage APIs about once a minute.

## Features

- **Side-notch UI** — a dark pill with circular usage rings (green / yellow /
  orange as usage climbs). Click a ring for a detail flyout with session and
  weekly meters. The tray popup uses the same dark cards.
- **Two ways to view:**
  - **Tray icon** — when the desktop widget is hidden, click to open a popup near
    the tray (click elsewhere to dismiss). When the widget is already visible,
    click focuses the widget instead (and expands it if it was tucked to the top
    edge). The icon itself is a live meter, like CodexBar's menu-bar bars: the
    thick bar is session quota left and the thin bar is weekly quota left for
    whichever visible provider is closest to its limit (green / amber / red).
    Hover it for every provider's remaining quota.
  - **Desktop widget** — an always-on-top, draggable card pinned to the top-right
    of the screen. Toggle it from the tray icon's right-click menu. Drag it to the
    left, right, or top edge (or click the Hide button for the nearest edge) and
    the ring pill sits flush on that edge. Click a ring to open the flyout, or use
    **Restore Widget Position** in the tray menu to undock.
- **Expandable flyout** — in the desktop widget, click a ring to open that
  provider's meters (e.g. Claude's Current session / All models; Cursor's Total /
  Auto / API). The tray popup always shows those details on each card.
- **Drag & drop reordering** — grab a card and drag it up or down; the other
  cards glide out of the way. The order is saved and restored across restarts.
- **Unconfigured providers are hidden** — no error spam for tools you don't use.
  Sign in later and the card appears automatically within a minute.
- **Rate-limit friendly** — Claude usage responses are cached and shared between
  the popup and the widget, a 429 triggers a long backoff (honoring
  `Retry-After`), and the last good snapshot is shown (with its timestamp) while
  the API is unavailable — even across app restarts.
- **Usage alerts** — a native OS notification when a provider's headline
  meter crosses 70% (warning) or 90% (critical). It fires once per crossing and
  again only after usage drops back below 65% / 85%. Hidden providers, errors,
  and stale snapshots never alert. Toggle **Usage Alerts** in the tray icon's
  right-click menu (on by default). On Linux this needs a notification daemon,
  which most desktop environments already run.
- **Pace forecast** — under each meter, a line predicts when you'll hit the
  limit at your recent rate ("At this pace, limit in 36m"), or says you're on
  pace to last until the reset. The rate comes from the last hour of samples
  (six hours for weekly/monthly windows) and needs about 10 minutes of
  observation after launch before it appears.
- **Service status** — every 5 minutes the app reads each provider's public
  status page (status.claude.com, status.openai.com, status.cursor.com,
  githubstatus.com) and, during an incident, puts a colored dot on that
  provider's ring, a "Partial outage: …" line on its card (click it to open the
  status page), a dot on the tray icon, and a note in the tray tooltip. Claude,
  Codex and Copilot only count the components those tools use (for example
  Copilot on GitHub's page). A notification fires when a provider goes into a
  partial or major outage (uses the **Usage Alerts** toggle). Turn checks off
  with **Service Status** in the tray menu. Antigravity has no public status
  page, so it is not checked. Only signed-in providers are checked.
- The window auto-sizes to its content, so the transparent widget never blocks
  clicks on what's behind it.

## Setup

```
npm install
npm start
```

To preview the widget UI without signing into any provider:

```
GENAI_USAGE_DEMO=1 npm start
```

### Installers

Prebuilt Windows `.exe` and Linux AppImage / `.deb` files are in [Downloads](#downloads), published for every tagged version by [`.github/workflows/release.yml`](.github/workflows/release.yml).

To build them yourself:

```
npm install
npm run dist -- --win     # Windows installer (dist/*.exe)
npm run dist -- --linux   # Linux AppImage + deb (dist/*.AppImage, dist/*.deb)
```

The app can launch automatically at login — toggle **Start at Login** from the
tray icon's right-click menu (off by default).

## Where each provider's credentials come from

| Provider | Source | Notes |
|---|---|---|
| Claude | `~/.claude/.credentials.json` | Written by the Claude Code CLI on login |
| Codex | `~/.codex/auth.json` | Written by the `codex` CLI (`npm i -g @openai/codex`, then `codex login`) |
| Copilot | `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` env vars, then the OS keychain (service `copilot-cli`), then `~/.copilot/config.json` | Run `copilot login` with the GitHub Copilot CLI (`npm i -g @github/copilot`). On Windows the keychain is read via `src/providers/win-cred-read.py`, so Python must be on `PATH`; on Linux it uses `secret-tool` (libsecret) when installed. Uses GitHub's unofficial `copilot_internal/user` endpoint, the same one the VS Code extension uses. |
| Cursor | Cursor app's `state.vscdb` (SQLite, via `sql.js`) | Requires the Cursor desktop app to be installed and signed in |
| Gemini CLI | `~/.gemini/oauth_creds.json` | Run `gemini` and choose **Sign in with Google** (API key and Vertex AI sign-ins have no quota to show). The access token expires after an hour; when it has, the app refreshes it in memory with the OAuth client found in your local `@google/gemini-cli` install, and never rewrites the CLI's own file. Sign-ins stored with `GEMINI_FORCE_ENCRYPTED_FILE_STORAGE=true` are not read. Uses the same unofficial `retrieveUserQuota` endpoint the CLI itself calls. |
| Antigravity | Windows Credential Manager (target `gemini:antigravity`) on Windows; `~/.gemini/antigravity-cli/antigravity-oauth-token` on Linux | Requires the `agy` CLI to have been used to sign in at least once (`winget install Google.AntigravityCLI` on Windows, or the official install script on Linux). On Windows the credential is read via a small Python helper script (`src/providers/win-cred-read.py`), so Python must be on `PATH`. On Linux it's a plain JSON file, no extra dependency needed. Not yet supported on macOS. |
| Windsurf | Windsurf app's `state.vscdb` (key `windsurf.settings.cachedPlanInfo`) | Requires the Windsurf desktop app to be installed and signed in. This is the plan status Windsurf caches locally, so it only updates while Windsurf is running. |
| Kiro | Kiro IDE's `~/.aws/sso/cache/kiro-auth-token.json`, then kiro-cli's `data.sqlite3` | Sign in to the Kiro IDE, or run `kiro-cli login`. Calls the same `GetUsageLimits` API Kiro itself uses. |

If a provider isn't set up, its card is hidden. If a provider is set up but its
API call fails, the card shows an error state (or, for Claude, the last
successfully fetched data marked with when it was fetched).

## Project structure

```
src/
  main.js              Electron main process: tray, popup window, widget window,
                       IPC, Claude response cache & 429 backoff
  widget-edge-hide.js  Geometry helpers for docking the ring pill to an edge
  preload.js           Exposes the get-*-usage IPC calls and window resizing
  index.html / renderer.js   Shared UI for both the popup and the widget
  providers/           One module per provider, each exporting a fetchXUsage()
                       function; not-configured.js marks "not set up" errors
  service-status.js    Polls provider status pages for outages
  demo-usage.js        Sample usage payloads for GENAI_USAGE_DEMO=1
scripts/capture-readme-screenshots.js  Regenerates README screenshots (`npm run screenshots`)
assets/icon.png        Tray icon
docs/screenshots/      README images (widget flyout + tray popup)
```

## Known limitations

- Antigravity support covers Windows and Linux; macOS isn't implemented yet (Cursor/Claude/Codex are cross-platform including macOS).
- Windsurf numbers come from Windsurf's local cache, so they can lag until the
  Windsurf app is opened again.
- No token-refresh handling yet — if a provider's token expires, its card shows
  an error until you re-authenticate with that provider's own CLI/app.
- Installers are unsigned, so Windows SmartScreen / Linux package managers may
  warn on first run — click through ("More info" → "Run anyway" on Windows).
