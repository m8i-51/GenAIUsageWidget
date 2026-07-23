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
  nearestHorizontalEdge,
  expandedBounds,
  collapsedBounds,
  normalizeEdge,
  isCursorNearDock,
  PEEK_SIZE,
  DEFAULT_FULL_WIDTH,
} = require('./widget-edge-hide');

let tray = null;
let popup = null;
let widget = null;
let lastTrayBounds = null;
let widgetBoundsSaveTimer = null;
let widgetSnapTimer = null;
let edgeHideCollapseTimer = null;
let dockedEdge = null;
let dockDisplayId = null;
let edgeHideExpanded = true;
let edgeHideHovering = false;
let ignoreHoverExpand = false;
let suppressMoveHandling = false;
let suppressHoverHandling = false;
let widgetFullWidth = DEFAULT_FULL_WIDTH;

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

function persistWidgetBoundsFromExpanded() {
  if (!widget || widget.isDestroyed() || !dockedEdge) return;
  const bounds = widget.getBounds();
  const display = resolveDockDisplay(bounds);
  const expanded = expandedBounds(dockedEdge, bounds, display.workArea, widgetFullWidth);
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
  suppressHoverHandling = true;
  try {
    fn();
  } finally {
    setTimeout(() => {
      suppressMoveHandling = false;
      suppressHoverHandling = false;
    }, 350);
  }
}

function setWidgetBounds(bounds) {
  if (!widget || widget.isDestroyed()) return;
  withSuppressedWindowEvents(() => {
    widget.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }, false);
  });
}

function applyEdgeHidePosition(expanded) {
  if (!widget || widget.isDestroyed() || !dockedEdge) return;
  const current = widget.getBounds();
  const workArea = getWidgetWorkArea(current);
  const next = expanded
    ? expandedBounds(dockedEdge, current, workArea, widgetFullWidth)
    : collapsedBounds(dockedEdge, current, workArea, PEEK_SIZE);
  edgeHideExpanded = expanded;
  setWidgetBounds(next);
  if (widget && !widget.isDestroyed()) {
    widget.webContents.send('widget-edge-hide-changed', {
      edge: dockedEdge,
      expanded,
    });
  }
}

function clearEdgeHideCollapseTimer() {
  if (edgeHideCollapseTimer) {
    clearTimeout(edgeHideCollapseTimer);
    edgeHideCollapseTimer = null;
  }
}

function cursorStillNearDock() {
  if (!dockedEdge || !widget || widget.isDestroyed()) return false;
  const bounds = widget.getBounds();
  const workArea = getWidgetWorkArea(bounds);
  return isCursorNearDock(
    dockedEdge,
    screen.getCursorScreenPoint(),
    workArea,
    bounds,
    widgetFullWidth
  );
}

function setDockedEdge(edge, { collapse = true, persist = true } = {}) {
  const normalized = normalizeEdge(edge);
  clearEdgeHideCollapseTimer();

  if (!normalized) {
    dockedEdge = null;
    dockDisplayId = null;
    edgeHideExpanded = true;
    if (widget && !widget.isDestroyed() && widget.getBounds().width < widgetFullWidth) {
      const bounds = widget.getBounds();
      withSuppressedWindowEvents(() => {
        widget.setBounds({
          x: bounds.x,
          y: bounds.y,
          width: widgetFullWidth,
          height: Math.max(bounds.height, 120),
        }, false);
      });
    }
    if (persist) {
      saveSettings({ widgetEdgeHide: null });
    }
    if (widget && !widget.isDestroyed()) {
      widget.webContents.send('widget-edge-hide-changed', { edge: null, expanded: true });
    }
    return;
  }

  if (widget && !widget.isDestroyed()) {
    const bounds = widget.getBounds();
    // Remember full width before collapsing to a peek strip.
    if (bounds.width >= PEEK_SIZE * 2) {
      widgetFullWidth = bounds.width;
    }
    dockDisplayId = String(resolveDockDisplay(bounds).id);
  }

  dockedEdge = normalized;
  applyEdgeHidePosition(!collapse);
  if (persist) {
    persistWidgetBoundsFromExpanded();
  }
}

function expandEdgeHide() {
  if (!dockedEdge || edgeHideExpanded || ignoreHoverExpand) return;
  clearEdgeHideCollapseTimer();
  applyEdgeHidePosition(true);
}

function collapseEdgeHide(delayMs = 0) {
  if (!dockedEdge || !edgeHideExpanded) return;
  clearEdgeHideCollapseTimer();
  const run = () => {
    edgeHideCollapseTimer = null;
    if (!dockedEdge) return;
    // Cursor still over the dock zone → keep expanded (prevents flee loop).
    if (cursorStillNearDock() || edgeHideHovering) return;
    applyEdgeHidePosition(false);
  };
  if (delayMs > 0) {
    edgeHideCollapseTimer = setTimeout(run, delayMs);
  } else {
    run();
  }
}

function evaluateSnapAfterMove() {
  if (!widget || widget.isDestroyed() || suppressMoveHandling) return;
  // Ignore snap while already collapsed to a peek strip — width is tiny and
  // would constantly re-trigger dock logic.
  if (dockedEdge && !edgeHideExpanded) return;

  const bounds = widget.getBounds();
  const workArea = getWidgetWorkArea(bounds);
  const edge = detectSnapEdge(bounds, workArea);
  if (edge) {
    setDockedEdge(edge, { collapse: !edgeHideHovering && !cursorStillNearDock(), persist: true });
  } else if (dockedEdge) {
    setDockedEdge(null, { persist: true });
    scheduleWidgetBoundsSave();
  } else {
    scheduleWidgetBoundsSave();
  }
}

function scheduleSnapEvaluation() {
  if (suppressMoveHandling) return;
  if (widgetSnapTimer) clearTimeout(widgetSnapTimer);
  widgetSnapTimer = setTimeout(() => {
    widgetSnapTimer = null;
    evaluateSnapAfterMove();
  }, 180);
}

function hideWidgetToNearestEdge() {
  if (!widget || widget.isDestroyed()) return;
  if (!widget.isVisible()) {
    widget.show();
  }
  const bounds = widget.getBounds();
  if (bounds.width >= PEEK_SIZE * 2) {
    widgetFullWidth = bounds.width;
  }
  dockDisplayId = String(resolveDockDisplay(bounds).id);
  const workArea = getWidgetWorkArea(bounds);
  const edge = nearestHorizontalEdge(bounds, workArea);
  // Hide button: collapse immediately and ignore hover-expand until pointer leaves.
  ignoreHoverExpand = true;
  setDockedEdge(edge, { collapse: true, persist: true });
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
    width: DEFAULT_FULL_WIDTH,
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

  widgetFullWidth = DEFAULT_FULL_WIDTH;
  widget.setAlwaysOnTop(true, 'floating');
  widget.loadFile(path.join(__dirname, 'index.html'), { query: { mode: 'widget' } });

  const settings = loadSettings();
  const { x, y } = resolveWidgetPosition(settings.widgetBounds, widget);
  widget.setPosition(x, y, false);

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
    if (dockedEdge && edgeHideExpanded) {
      clearEdgeHideCollapseTimer();
    }
    scheduleSnapEvaluation();
  });
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
    togglePopup(bounds);
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: widget?.isVisible() ? 'Hide Desktop Widget' : 'Show Desktop Widget',
        click: () => toggleWidget(),
      },
      {
        label: dockedEdge ? 'Undock Widget' : 'Hide to Screen Edge',
        click: () => {
          if (dockedEdge) {
            const bounds = widget.getBounds();
            const workArea = getWidgetWorkArea(bounds);
            const pos = expandedBounds(dockedEdge, bounds, workArea, widgetFullWidth);
            setDockedEdge(null, { persist: true });
            setWidgetBounds(pos);
            scheduleWidgetBoundsSave();
          } else {
            hideWidgetToNearestEdge();
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

ipcMain.on('widget-edge-hide-hover', (_event, hovering) => {
  if (suppressHoverHandling) return;
  edgeHideHovering = !!hovering;
  if (!hovering) {
    ignoreHoverExpand = false;
  }
  if (!dockedEdge) return;
  if (edgeHideHovering) {
    expandEdgeHide();
  } else {
    // Longer delay + cursor zone check avoids expand/collapse flee loops.
    collapseEdgeHide(700);
  }
});

ipcMain.on('widget-hide-to-edge', () => {
  hideWidgetToNearestEdge();
});

ipcMain.on('widget-show-from-edge', () => {
  ignoreHoverExpand = false;
  edgeHideHovering = true;
  expandEdgeHide();
});

ipcMain.handle('get-claude-usage', () => fetchWithCache('claude', fetchClaudeUsage));
ipcMain.handle('get-codex-usage', () => fetchWithCache('codex', fetchCodexUsage));
ipcMain.handle('get-cursor-usage', () => fetchWithCache('cursor', fetchCursorUsage));
ipcMain.handle('get-antigravity-usage', () => fetchWithCache('antigravity', fetchAntigravityUsage));

ipcMain.on('resize-to', (event, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const clamped = Math.max(120, Math.min(900, Math.round(height)));

  if (win === widget && dockedEdge && !edgeHideExpanded) {
    // Peek strip: keep narrow width on the docked display.
    const current = win.getBounds();
    const workArea = getWidgetWorkArea(current);
    const next = collapsedBounds(dockedEdge, { ...current, height: clamped }, workArea, PEEK_SIZE);
    withSuppressedWindowEvents(() => {
      win.setBounds({
        x: Math.round(next.x),
        y: Math.round(next.y),
        width: Math.round(next.width),
        height: Math.round(next.height),
      }, false);
    });
    return;
  }

  const width = (win === widget && dockedEdge)
    ? widgetFullWidth
    : win.getContentSize()[0];
  win.setContentSize(width, clamped);

  if (win === popup && popup.isVisible() && lastTrayBounds) {
    const { x, y } = getPopupPosition(lastTrayBounds);
    popup.setPosition(x, y, false);
  }
  if (win === widget && dockedEdge && edgeHideExpanded) {
    applyEdgeHidePosition(true);
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
