const { app, Tray, Menu, BrowserWindow, screen, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { fetchClaudeUsage } = require('./providers/claude');
const { fetchCodexUsage } = require('./providers/codex');
const { fetchCursorUsage } = require('./providers/cursor');
const { fetchAntigravityUsage } = require('./providers/antigravity');
const autostart = require('./autostart');

let tray = null;
let popup = null;
let widget = null;
let lastTrayBounds = null;

function createPopup() {
  popup = new BrowserWindow({
    width: 320,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  popup.loadFile(path.join(__dirname, 'index.html'));

  // Hide the popup when it loses focus, like a typical tray dropdown.
  popup.on('blur', () => {
    popup.hide();
  });
}

function getPopupPosition(bounds) {
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const { width: popupWidth, height: popupHeight } = popup.getBounds();

  let x = Math.round(bounds.x + bounds.width / 2 - popupWidth / 2);
  let y;

  if (process.platform === 'darwin') {
    y = Math.round(bounds.y + bounds.height);
  } else {
    // Windows/Linux: tray is usually at the bottom of the screen.
    y = Math.round(bounds.y - popupHeight);
  }

  // Keep the popup within the display bounds.
  x = Math.min(Math.max(x, display.workArea.x), display.workArea.x + display.workArea.width - popupWidth);
  y = Math.min(Math.max(y, display.workArea.y), display.workArea.y + display.workArea.height - popupHeight);

  return { x, y };
}

function togglePopup(bounds) {
  if (popup.isVisible()) {
    popup.hide();
    return;
  }
  lastTrayBounds = bounds;
  const { x, y } = getPopupPosition(bounds);
  popup.setPosition(x, y, false);
  popup.show();
  popup.focus();
}

function createWidget() {
  widget = new BrowserWindow({
    width: 300,
    height: 480,
    show: true,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  widget.setAlwaysOnTop(true, 'floating');
  widget.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'widget' } });

  const display = screen.getPrimaryDisplay();
  const margin = 16;
  const { width, height } = widget.getBounds();
  widget.setPosition(
    display.workArea.x + display.workArea.width - width - margin,
    display.workArea.y + margin,
    false,
  );
}

function toggleWidget() {
  if (!widget) return;
  if (widget.isVisible()) {
    widget.hide();
  } else {
    widget.show();
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
  tray.setToolTip('GenAIUsageWidget');

  tray.on('click', (_event, bounds) => {
    togglePopup(bounds);
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: widget?.isVisible() ? 'Hide Desktop Widget' : 'Show Desktop Widget',
        click: () => toggleWidget(),
      },
      { type: 'separator' },
      {
        label: 'Start at Login',
        type: 'checkbox',
        checked: autostart.isEnabled(),
        click: (menuItem) => autostart.setEnabled(menuItem.checked),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.popUpContextMenu(contextMenu);
  });
}

// The Anthropic usage endpoint rate-limits aggressively, and both the popup
// and the widget poll it. Cache the result (errors included) and share a
// single in-flight request, so the API sees a call every ~2.5 min at most.
const CLAUDE_CACHE_TTL_MS = 150 * 1000;
const CLAUDE_429_BACKOFF_MS = 10 * 60 * 1000;
let claudeCache = null;
let claudePending = null;
let claudeLastGood = null;

// Persist the last good snapshot so a restart during an outage/rate-limit
// can still show data. resetsAt values are absolute, so countdowns stay
// correct even when the snapshot is old.
function claudeLastGoodPath() {
  return path.join(app.getPath('userData'), 'claude-last-good.json');
}

function loadClaudeLastGood() {
  try {
    const saved = JSON.parse(fs.readFileSync(claudeLastGoodPath(), 'utf8'));
    if (saved && saved.usage && saved.at) claudeLastGood = saved;
  } catch {
    // No snapshot yet (or unreadable) — start empty.
  }
}

function saveClaudeLastGood() {
  fs.writeFile(claudeLastGoodPath(), JSON.stringify(claudeLastGood), () => {});
}

ipcMain.handle('get-claude-usage', async () => {
  if (claudeCache && Date.now() - claudeCache.at < claudeCache.ttl) {
    return claudeCache.payload;
  }
  if (!claudePending) {
    claudePending = (async () => {
      let payload;
      let ttl = CLAUDE_CACHE_TTL_MS;
      try {
        const usage = await fetchClaudeUsage();
        claudeLastGood = { usage, at: Date.now() };
        saveClaudeLastGood();
        payload = { ok: true, usage };
      } catch (err) {
        // When rate-limited, honor Retry-After if given, otherwise back way off.
        if (err.status === 429) {
          ttl = err.retryAfterMs ?? CLAUDE_429_BACKOFF_MS;
        }
        if (!err.notConfigured && claudeLastGood) {
          // Transient failure: serve the last good data, marked stale.
          payload = {
            ok: true,
            usage: claudeLastGood.usage,
            stale: true,
            staleAt: claudeLastGood.at,
            staleError: err.message,
          };
        } else {
          payload = { ok: false, error: err.message, notConfigured: !!err.notConfigured };
        }
      }
      claudeCache = { at: Date.now(), ttl, payload };
      claudePending = null;
      return payload;
    })();
  }
  return claudePending;
});

// The renderer reports its content height so each window can hug the card —
// otherwise the transparent leftover area still swallows mouse clicks.
ipcMain.on('resize-to', (event, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const [width] = win.getContentSize();
  const clamped = Math.max(120, Math.min(900, Math.round(height)));
  win.setContentSize(width, clamped);
  // Keep the popup anchored to the tray (it opens above the tray on Windows,
  // so growing downward would run into the taskbar).
  if (win === popup && popup.isVisible() && lastTrayBounds) {
    const { x, y } = getPopupPosition(lastTrayBounds);
    popup.setPosition(x, y, false);
  }
});

ipcMain.handle('get-codex-usage', async () => {
  try {
    const usage = await fetchCodexUsage();
    return { ok: true, usage };
  } catch (err) {
    return { ok: false, error: err.message, notConfigured: !!err.notConfigured };
  }
});

ipcMain.handle('get-cursor-usage', async () => {
  try {
    const usage = await fetchCursorUsage();
    return { ok: true, usage };
  } catch (err) {
    return { ok: false, error: err.message, notConfigured: !!err.notConfigured };
  }
});

ipcMain.handle('get-antigravity-usage', async () => {
  try {
    const usage = await fetchAntigravityUsage();
    return { ok: true, usage };
  } catch (err) {
    return { ok: false, error: err.message, notConfigured: !!err.notConfigured };
  }
});

app.whenReady().then(() => {
  loadClaudeLastGood();
  createPopup();
  createWidget();
  createTray();
});

app.on('window-all-closed', (event) => {
  // Keep the app alive in the tray even when the popup window closes.
  event.preventDefault();
});
