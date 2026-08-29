const { app, Tray, Menu, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { fetchClaudeUsage } = require('./providers/claude');
const { fetchCodexUsage } = require('./providers/codex');
const { fetchCursorUsage } = require('./providers/cursor');
const { fetchAntigravityUsage } = require('./providers/antigravity');
const autostart = require('./autostart');
const { loadSettings, saveSettings } = require('./settings');
const { fetchWithCache, preloadLastGood } = require('./usage-cache');
const {
  detectSnapEdge,
  preferDockEdge,
  expandedBounds,
  collapsedBounds,
  normalizeEdge,
  decideMoveSnap,
  PEEK_SIZE,
  DEFAULT_FULL_WIDTH,
  DEFAULT_FULL_HEIGHT,
} = require('./widget-edge-hide');

let tray = null;
let popup = null;
let widget = null;
let lastTrayBounds = null;
let widgetBoundsSaveTimer = null;
let widgetSnapTimer = null;
let dockedEdge = null;
let dockDisplayId = null;
let edgeHideExpanded = true;
let edgeHidePinned = false;
let suppressMoveHandling = false;
let snapArmedAt = 0;
let widgetFullWidth = DEFAULT_FULL_WIDTH;
let widgetFullHeight = DEFAULT_FULL_HEIGHT;

function broadcastSettings(settings) {
  for (const win of [popup, widget]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings-changed', settings);
    }
  }
}

function getDefaultWidgetPosition(win) {
  const display = screen.getPrimaryDisplay();
  // Stay outside EDGE_SNAP_THRESHOLD (28) so first launch does not auto-dock.
  const margin = 40;
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

function resolveDockDisplay(bounds = null) {
  if (dockDisplayId != null) {
    const pinned = screen.getAllDisplays().find((d) => String(d.id) === String(dockDisplayId));
    if (pinned) return pinned;
  }
  if (bounds) {
    return screen.getDisplayMatching(bounds) || screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  }
  if (widget && !widget.isDestroyed()) {
    return screen.getDisplayMatching(widget.getBounds());
  }
  return screen.getPrimaryDisplay();
}

function getWidgetWorkArea(bounds = null) {
  return resolveDockDisplay(bounds).workArea;
}

function rememberExpandedSize(bounds) {
  if (!bounds) return;
  // The collapsed pill is PEEK_SIZE thick; do not treat that as the open size.
  if (dockedEdge && !edgeHideExpanded) return;
  if (bounds.width >= DEFAULT_FULL_WIDTH - 4) {
    widgetFullWidth = Math.min(640, bounds.width);
  }
  if (bounds.height >= 120) {
    widgetFullHeight = Math.min(900, bounds.height);
  }
}

function persistWidgetBoundsFromExpanded() {
  if (!widget || widget.isDestroyed() || !dockedEdge) return;
  const bounds = widget.getBounds();
  const display = resolveDockDisplay(bounds);
  const expanded = expandedBounds(
    dockedEdge,
    bounds,
    display.workArea,
    widgetFullWidth,
    widgetFullHeight
  );
  saveSettings({
    widgetBounds: { x: expanded.x, y: expanded.y, displayId: String(display.id) },
    widgetEdgeHide: dockedEdge,
  });
}

function scheduleWidgetBoundsSave() {
  if (!widget || widget.isDestroyed()) return;
  if (dockedEdge) {
    persistWidgetBoundsFromExpanded();
    return;
  }
  if (widgetBoundsSaveTimer) clearTimeout(widgetBoundsSaveTimer);
  widgetBoundsSaveTimer = setTimeout(() => {
    widgetBoundsSaveTimer = null;
    if (!widget || widget.isDestroyed() || dockedEdge) return;
    const [x, y] = widget.getPosition();
    const display = screen.getDisplayNearestPoint({ x, y });
    saveSettings({
      widgetBounds: { x, y, displayId: String(display.id) },
      widgetEdgeHide: null,
    });
  }, 500);
}

function withSuppressedWindowEvents(fn) {
  if (!widget || widget.isDestroyed()) return;
  suppressMoveHandling = true;
  try {
    fn();
  } finally {
    setTimeout(() => {
      suppressMoveHandling = false;
    }, 350);
  }
}

function setWidgetBounds(bounds) {
  if (!widget || widget.isDestroyed()) return;
  const current = widget.getBounds();
  const width = Math.max(PEEK_SIZE, Math.min(640, Math.round(bounds.width)));
  const height = Math.max(PEEK_SIZE, Math.min(900, Math.round(bounds.height)));
  withSuppressedWindowEvents(() => {
    const shrinking = width < current.width - 4 || height < current.height - 4;
    if (shrinking) {
      // Shrink first so a docked-right flyout does not carry the notch off-screen.
      widget.setSize(width, height, false);
      widget.setPosition(Math.round(bounds.x), Math.round(bounds.y), false);
    } else {
      // Grow: move first so Linux does not expand off the right edge and clamp-dock.
      widget.setPosition(Math.round(bounds.x), Math.round(bounds.y), false);
      widget.setSize(width, height, false);
    }
    widget.setMinimumSize(PEEK_SIZE, PEEK_SIZE);
    widget.setMaximumSize(640, 900);
  });
}

function broadcastEdgeHideState() {
  if (!widget || widget.isDestroyed()) return;
  widget.webContents.send('widget-edge-hide-changed', {
    edge: dockedEdge,
    expanded: edgeHideExpanded,
    pinned: edgeHidePinned,
  });
}

function applyEdgeHidePosition(expanded) {
  if (!widget || widget.isDestroyed() || !dockedEdge) return;
  edgeHideExpanded = expanded;
  if (!expanded) {
    edgeHidePinned = false;
  }

  const place = () => {
    if (!widget || widget.isDestroyed() || !dockedEdge) return;
    const current = widget.getBounds();
    const workArea = getWidgetWorkArea(current);
    const next = expanded
      ? expandedBounds(dockedEdge, current, workArea, widgetFullWidth, widgetFullHeight)
      : collapsedBounds(dockedEdge, current, workArea, PEEK_SIZE, widgetFullWidth, widgetFullHeight);
    setWidgetBounds(next);
  };

  broadcastEdgeHideState();
  if (!expanded && widget.webContents && !widget.webContents.isDestroyed()) {
    // Hide the flyout in the page before shrinking, or Linux keeps the old
    // width and the rings slide off the right edge.
    widget.webContents
      .executeJavaScript(`
        document.body.classList.add('edge-collapsed');
        document.documentElement.classList.add('widget-edge-fill');
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
      `)
      .then(place)
      .catch(place);
    return;
  }
  place();
}

function restoreFullSizeAt(bounds) {
  if (!widget || widget.isDestroyed()) return;
  const width = Math.max(PEEK_SIZE, Math.min(640, Math.round(widgetFullWidth)));
  const height = Math.max(120, Math.min(900, Math.round(widgetFullHeight)));
  withSuppressedWindowEvents(() => {
    widget.setPosition(bounds.x, bounds.y, false);
    widget.setSize(width, height, false);
  });
}

function setDockedEdge(edge, { collapse = true, persist = true, pinned = false } = {}) {
  const normalized = normalizeEdge(edge);

  if (!normalized) {
    dockedEdge = null;
    dockDisplayId = null;
    edgeHideExpanded = true;
    edgeHidePinned = false;
    if (widget && !widget.isDestroyed()) {
      const bounds = widget.getBounds();
      if (bounds.width < widgetFullWidth - 4 || bounds.height < PEEK_SIZE * 2) {
        restoreFullSizeAt(bounds);
      }
    }
    if (persist) {
      saveSettings({ widgetEdgeHide: null });
    }
    broadcastEdgeHideState();
    return;
  }

  if (widget && !widget.isDestroyed()) {
    const bounds = widget.getBounds();
    rememberExpandedSize(bounds);
    dockDisplayId = String(resolveDockDisplay(bounds).id);
  }

  dockedEdge = normalized;
  edgeHidePinned = !collapse && pinned;
  applyEdgeHidePosition(!collapse);
  if (persist) {
    persistWidgetBoundsFromExpanded();
  }
}

function expandEdgeHide({ pinned = true } = {}) {
  if (!dockedEdge) return;
  if (pinned) {
    edgeHidePinned = true;
  }
  if (!edgeHideExpanded) {
    applyEdgeHidePosition(true);
  } else if (pinned) {
    broadcastEdgeHideState();
  }
}

function evaluateSnapAfterMove() {
  if (!widget || widget.isDestroyed() || suppressMoveHandling) return;
  if (Date.now() < snapArmedAt) return;

  const bounds = widget.getBounds();
  const workArea = getWidgetWorkArea(bounds);
  const detectedEdge = detectSnapEdge(bounds, workArea);
  const action = decideMoveSnap({
    dockedEdge,
    expanded: edgeHideExpanded,
    detectedEdge,
  });

  if (action === 'ignore') return;
  if (action === 'keep-expanded') {
    persistWidgetBoundsFromExpanded();
    return;
  }
  if (action === 'dock-collapse') {
    edgeHidePinned = false;
    setDockedEdge(detectedEdge, { collapse: true, persist: true });
    return;
  }
  if (action === 'undock') {
    setDockedEdge(null, { persist: true });
    scheduleWidgetBoundsSave();
    return;
  }
  scheduleWidgetBoundsSave();
}

function scheduleSnapEvaluation() {
  if (suppressMoveHandling) return;
  if (widgetSnapTimer) clearTimeout(widgetSnapTimer);
  widgetSnapTimer = setTimeout(() => {
    widgetSnapTimer = null;
    evaluateSnapAfterMove();
  }, 180);
}

function hideWidgetToEdge() {
  if (!widget || widget.isDestroyed()) return;
  if (!widget.isVisible()) {
    widget.show();
  }
  const bounds = widget.getBounds();
  rememberExpandedSize(bounds);
  const workArea = getWidgetWorkArea(bounds);
  dockDisplayId = String(resolveDockDisplay(bounds).id);
  edgeHidePinned = false;
  setDockedEdge(preferDockEdge(bounds, workArea), { collapse: true, persist: true });
}

function createPopup() {
  popup = new BrowserWindow({
    width: 320,
    height: 480,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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
    width: DEFAULT_FULL_WIDTH,
    height: 480,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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

  widgetFullWidth = DEFAULT_FULL_WIDTH;
  widgetFullHeight = DEFAULT_FULL_HEIGHT;
  widget.setAlwaysOnTop(true, 'floating');
  widget.setMinimumSize(PEEK_SIZE, PEEK_SIZE);
  widget.setMaximumSize(640, 900);
  widget.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'widget' } });

  const settings = loadSettings();
  const { x, y } = resolveWidgetPosition(settings.widgetBounds, widget);
  withSuppressedWindowEvents(() => {
    widget.setPosition(x, y, false);
  });

  const savedEdge = normalizeEdge(settings.widgetEdgeHide);
  if (savedEdge) {
    if (settings.widgetBounds?.displayId != null) {
      dockDisplayId = String(settings.widgetBounds.displayId);
    }
    widget.webContents.once('did-finish-load', () => {
      setDockedEdge(savedEdge, { collapse: true, persist: false });
    });
  }

  widget.on('move', () => {
    if (suppressMoveHandling) return;
    scheduleSnapEvaluation();
  });
  snapArmedAt = Date.now() + 2500;
}

function toggleWidget() {
  if (!widget) return;
  if (widget.isVisible()) {
    widget.hide();
  } else {
    widget.show();
    if (dockedEdge && !edgeHideExpanded) {
      applyEdgeHidePosition(false);
    }
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
  tray.setToolTip('GenAIUsageWidget');

  tray.on('click', (_event, bounds) => {
    if (widget && !widget.isDestroyed() && widget.isVisible()) {
      widget.show();
      widget.focus();
      if (dockedEdge && !edgeHideExpanded) {
        expandEdgeHide({ pinned: true });
      }
      return;
    }
    togglePopup(bounds);
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: widget?.isVisible() ? 'Hide Desktop Widget' : 'Show Desktop Widget',
        click: () => toggleWidget(),
      },
      {
        label: dockedEdge ? 'Restore Widget Position' : 'Hide to Edge',
        click: () => {
          if (dockedEdge) {
            const bounds = widget.getBounds();
            const workArea = getWidgetWorkArea(bounds);
            const pos = expandedBounds(
              dockedEdge,
              bounds,
              workArea,
              widgetFullWidth,
              widgetFullHeight
            );
            setDockedEdge(null, { persist: true });
            setWidgetBounds(pos);
            scheduleWidgetBoundsSave();
          } else {
            hideWidgetToEdge();
          }
        },
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

ipcMain.on('widget-hide-to-edge', () => {
  hideWidgetToEdge();
});

ipcMain.on('widget-show-from-edge', () => {
  // Explicit click = stay open until the user hides again.
  expandEdgeHide({ pinned: true });
});

ipcMain.handle('get-claude-usage', () => {
  if (process.env.GENAI_USAGE_DEMO === '1') return require('./demo-usage').claude();
  return fetchWithCache('claude', fetchClaudeUsage);
});
ipcMain.handle('get-codex-usage', () => {
  if (process.env.GENAI_USAGE_DEMO === '1') return require('./demo-usage').codex();
  return fetchWithCache('codex', fetchCodexUsage);
});
ipcMain.handle('get-cursor-usage', () => {
  if (process.env.GENAI_USAGE_DEMO === '1') return require('./demo-usage').cursor();
  return fetchWithCache('cursor', fetchCursorUsage);
});
ipcMain.handle('get-antigravity-usage', () => {
  if (process.env.GENAI_USAGE_DEMO === '1') return require('./demo-usage').antigravity();
  return fetchWithCache('antigravity', fetchAntigravityUsage);
});

ipcMain.on('resize-to', (event, size) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const current = win.getBounds();
  let nextWidth = current.width;
  let nextHeight;
  if (typeof size === 'number') {
    nextHeight = size;
  } else if (size && typeof size === 'object') {
    nextHeight = size.height;
    if (typeof size.width === 'number') nextWidth = size.width;
  } else {
    return;
  }

  const clampedH = Math.max(PEEK_SIZE, Math.min(900, Math.round(nextHeight)));
  const clampedW = Math.max(PEEK_SIZE, Math.min(640, Math.round(nextWidth)));

  if (win === widget && dockedEdge && !edgeHideExpanded) {
    const workArea = getWidgetWorkArea(current);
    const next = collapsedBounds(dockedEdge, current, workArea, PEEK_SIZE, widgetFullWidth, widgetFullHeight);
    withSuppressedWindowEvents(() => {
      win.setPosition(Math.round(next.x), Math.round(next.y), false);
      win.setSize(
        Math.max(PEEK_SIZE, Math.min(640, Math.round(next.width))),
        Math.max(PEEK_SIZE, Math.min(900, Math.round(next.height))),
        false
      );
    });
    return;
  }

  if (win === widget) {
    const workArea = getWidgetWorkArea(current);
    widgetFullHeight = clampedH;
    widgetFullWidth = clampedW;

    let x = current.x;
    let y = current.y;
    if (dockedEdge === 'right') {
      x = workArea.x + workArea.width - clampedW;
    } else if (dockedEdge === 'left') {
      x = workArea.x;
    } else if (dockedEdge === 'top') {
      y = workArea.y;
    } else {
      // Keep the notch (right edge of the window) still when the flyout opens.
      x = current.x + current.width - clampedW;
    }

    x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - clampedW);
    y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - clampedH);
    setWidgetBounds({ x, y, width: clampedW, height: clampedH });
    return;
  }

  win.setContentSize(clampedW, clampedH);

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
