const { app, Tray, Menu, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { fetchClaudeUsage } = require('./providers/claude');
const { fetchCodexUsage } = require('./providers/codex');
const { fetchCursorUsage } = require('./providers/cursor');
const { fetchAntigravityUsage } = require('./providers/antigravity');
const autostart = require('./autostart');
const { loadSettings, saveSettings } = require('./settings');
const { fetchWithCache, preloadLastGood } = require('./usage-cache');

let tray = null;
let popup = null;
let widget = null;
let lastTrayBounds = null;
let widgetBoundsSaveTimer = null;

function broadcastSettings(settings) {
  for (const win of [popup, widget]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings-changed', settings);
    }
  }
}

function getDefaultWidgetPosition(win) {
  const display = screen.getPrimaryDisplay();
  const margin = 16;
  const { width, height } = win.getBounds();
  return {
    x: display.workArea.x + display.workArea.width - width - margin,
    y: display.workArea.y + margin,
  };
}

function clampToWorkArea(x, y, width, height, display) {
  const area = display.workArea;
  const clampedX = Math.min(Math.max(x, area.x), area.x + area.width - width);
  const clampedY = Math.min(Math.max(y, area.y), area.y + area.height - height);
  return { x: clampedX, y: clampedY };
}

function resolveWidgetPosition(savedBounds, win) {
  const { width, height } = win.getBounds();

  if (!savedBounds || typeof savedBounds.x !== 'number' || typeof savedBounds.y !== 'number') {
    return getDefaultWidgetPosition(win);
  }

  let display = null;
  if (savedBounds.displayId != null) {
    display = screen.getAllDisplays().find((d) => String(d.id) === String(savedBounds.displayId));
  }
  if (!display) {
    display = screen.getDisplayNearestPoint({ x: savedBounds.x, y: savedBounds.y });
  }
  if (!display) {
    display = screen.getPrimaryDisplay();
  }

  return clampToWorkArea(savedBounds.x, savedBounds.y, width, height, display);
}

function scheduleWidgetBoundsSave() {
  if (!widget || widget.isDestroyed()) return;
  if (widgetBoundsSaveTimer) clearTimeout(widgetBoundsSaveTimer);
  widgetBoundsSaveTimer = setTimeout(() => {
    widgetBoundsSaveTimer = null;
    const [x, y] = widget.getPosition();
    const display = screen.getDisplayNearestPoint({ x, y });
    saveSettings({
      widgetBounds: { x, y, displayId: String(display.id) },
    });
  }, 500);
}

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
    y = Math.round(bounds.y - popupHeight);
  }

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

  const settings = loadSettings();
  const { x, y } = resolveWidgetPosition(settings.widgetBounds, widget);
  widget.setPosition(x, y, false);

  widget.on('move', scheduleWidgetBoundsSave);
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

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('set-settings', (_event, partial) => {
  const settings = saveSettings(partial);
  broadcastSettings(settings);
  return settings;
});

ipcMain.on('save-widget-bounds', (_event, bounds) => {
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return;
  saveSettings({
    widgetBounds: {
      x: bounds.x,
      y: bounds.y,
      displayId: bounds.displayId != null ? String(bounds.displayId) : undefined,
    },
  });
});

ipcMain.handle('get-claude-usage', () => fetchWithCache('claude', fetchClaudeUsage));
ipcMain.handle('get-codex-usage', () => fetchWithCache('codex', fetchCodexUsage));
ipcMain.handle('get-cursor-usage', () => fetchWithCache('cursor', fetchCursorUsage));
ipcMain.handle('get-antigravity-usage', () => fetchWithCache('antigravity', fetchAntigravityUsage));

ipcMain.on('resize-to', (event, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const [width] = win.getContentSize();
  const clamped = Math.max(120, Math.min(900, Math.round(height)));
  win.setContentSize(width, clamped);
  if (win === popup && popup.isVisible() && lastTrayBounds) {
    const { x, y } = getPopupPosition(lastTrayBounds);
    popup.setPosition(x, y, false);
  }
});

app.whenReady().then(() => {
  preloadLastGood(['claude', 'codex', 'cursor', 'antigravity']);
  loadSettings();
  createPopup();
  createWidget();
  createTray();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
