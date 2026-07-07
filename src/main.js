const { app, Tray, Menu, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { fetchClaudeUsage } = require('./providers/claude');
const { fetchCodexUsage } = require('./providers/codex');
const { fetchCursorUsage } = require('./providers/cursor');
const { fetchAntigravityUsage } = require('./providers/antigravity');

let tray = null;
let popup = null;
let widget = null;

function createPopup() {
  popup = new BrowserWindow({
    width: 320,
    height: 430,
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
  const { x, y } = getPopupPosition(bounds);
  popup.setPosition(x, y, false);
  popup.show();
  popup.focus();
}

function createWidget() {
  widget = new BrowserWindow({
    width: 300,
    height: 420,
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
  tray.setToolTip('Codex Tray Bar');

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
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.popUpContextMenu(contextMenu);
  });
}

ipcMain.handle('get-claude-usage', async () => {
  try {
    const usage = await fetchClaudeUsage();
    return { ok: true, usage };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-codex-usage', async () => {
  try {
    const usage = await fetchCodexUsage();
    return { ok: true, usage };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-cursor-usage', async () => {
  try {
    const usage = await fetchCursorUsage();
    return { ok: true, usage };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-antigravity-usage', async () => {
  try {
    const usage = await fetchAntigravityUsage();
    return { ok: true, usage };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createPopup();
  createWidget();
  createTray();
});

app.on('window-all-closed', (event) => {
  // Keep the app alive in the tray even when the popup window closes.
  event.preventDefault();
});
