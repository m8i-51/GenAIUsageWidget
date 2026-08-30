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
  edgeDistances,
  expandedBounds,
  collapsedBounds,
  normalizeEdge,
  decideMoveSnap,
  PEEK_SIZE,
  SIDE_PILL_WIDTH,
  MIN_WIDGET_SIZE,
  DEFAULT_FULL_WIDTH,
  DEFAULT_FULL_HEIGHT,
  COLLAPSED_SIDE_HEIGHT,
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
let edgeTransitioning = false;
let dockLockUntil = 0;
let suppressMoveHandling = false;
let snapArmedAt = 0;
let widgetFullWidth = DEFAULT_FULL_WIDTH;
let widgetFullHeight = DEFAULT_FULL_HEIGHT;
let collapsedPeekHeight = COLLAPSED_SIDE_HEIGHT;
let collapsedPeekWidth = SIDE_PILL_WIDTH;
/** @type {{ offsetX: number, offsetY: number } | null} */
let widgetDrag = null;

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

function getWidgetScreenBounds(bounds = null) {
  return resolveDockDisplay(bounds).bounds;
}

/**
 * Area used to pin the docked edge. Prefer the monitor frame so the notch
 * sits on the true screen edge (workArea can leave a wallpaper strip).
 */
function getDockEdgeArea(bounds = null) {
  return getWidgetScreenBounds(bounds);
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
    widgetFullHeight,
    display.bounds
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
    }, 450);
  }
}

function dockedPositionForSize(edge, bounds, workArea, width, height, edgeArea = workArea) {
  const flush = edgeArea || workArea;
  if (edge === 'left') {
    return { x: flush.x, y: clampDockY(bounds.y, height, workArea) };
  }
  if (edge === 'right') {
    return {
      x: flush.x + flush.width - width,
      y: clampDockY(bounds.y, height, workArea),
    };
  }
  if (edge === 'top') {
    return {
      x: clampDockX(bounds.x + bounds.width / 2 - width / 2, width, workArea),
      y: flush.y,
    };
  }
  return {
    x: clampDockX(bounds.x + bounds.width / 2 - width / 2, width, workArea),
    y: flush.y + flush.height - height,
  };
}

function clampDockX(x, width, workArea) {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
  return Math.min(Math.max(Math.round(x), workArea.x), maxX);
}

function clampDockY(y, height, workArea) {
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);
  return Math.min(Math.max(Math.round(y), workArea.y), maxY);
}

function enforceDockPosition() {
  if (!widget || widget.isDestroyed() || !dockedEdge) return;
  const bounds = widget.getBounds();
  const workArea = getWidgetWorkArea(bounds);
  const edgeArea = getDockEdgeArea(bounds);
  const pos = dockedPositionForSize(
    dockedEdge,
    bounds,
    workArea,
    bounds.width,
    bounds.height,
    edgeArea
  );
  if (pos.x !== bounds.x || pos.y !== bounds.y) {
    suppressMoveHandling = true;
    widget.setPosition(pos.x, pos.y, false);
    setTimeout(() => {
      suppressMoveHandling = false;
    }, 450);
  }
}

function setWidgetBounds(bounds) {
  if (!widget || widget.isDestroyed()) return;
  const next = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(MIN_WIDGET_SIZE, Math.min(640, Math.round(bounds.width))),
    height: Math.max(MIN_WIDGET_SIZE, Math.min(900, Math.round(bounds.height))),
  };
  withSuppressedWindowEvents(() => {
    // Collapsed side pill must stay clickable (Windows + ignore-mouse is flaky
    // on tiny transparent windows).
    if (!edgeHideExpanded && (dockedEdge === 'left' || dockedEdge === 'right')) {
      widget.setIgnoreMouseEvents(false);
    }
    // Windows often re-anchors during resize. Pin the docked edge explicitly:
    // left/top → size then position; right/bottom → position, size, position again.
    if (dockedEdge === 'left' || dockedEdge === 'top') {
      widget.setSize(next.width, next.height, false);
      widget.setPosition(next.x, next.y, false);
    } else if (dockedEdge === 'right' || dockedEdge === 'bottom') {
      widget.setPosition(next.x, next.y, false);
      widget.setSize(next.width, next.height, false);
      widget.setPosition(next.x, next.y, false);
    } else {
      widget.setBounds(next, false);
    }
    widget.setMinimumSize(MIN_WIDGET_SIZE, MIN_WIDGET_SIZE);
    widget.setMaximumSize(640, 900);

    const actual = widget.getBounds();
    if (actual.x !== next.x || actual.y !== next.y) {
      widget.setPosition(next.x, next.y, false);
    }
    if (actual.width !== next.width || actual.height !== next.height) {
      widget.setSize(next.width, next.height, false);
      if (dockedEdge === 'right' || dockedEdge === 'bottom') {
        widget.setPosition(next.x, next.y, false);
      }
    }
  });
  // One more pass after the compositor settles (Windows DPI / DWM).
  if (dockedEdge) {
    setTimeout(enforceDockPosition, 0);
    setTimeout(enforceDockPosition, 50);
  }
}

function lockDock(ms = 800) {
  dockLockUntil = Date.now() + ms;
}

function pinDockedWidget(width, height, bounds = null) {
  if (!widget || widget.isDestroyed() || !dockedEdge) return;
  const current = bounds || widget.getBounds();
  const workArea = getWidgetWorkArea(current);
  const edgeArea = getDockEdgeArea(current);
  const w = Math.max(PEEK_SIZE, Math.min(640, Math.round(width)));
  const h = Math.max(PEEK_SIZE, Math.min(900, Math.round(height)));
  if (edgeHideExpanded) {
    widgetFullWidth = w;
    widgetFullHeight = h;
    setWidgetBounds(expandedBounds(dockedEdge, current, workArea, w, h, edgeArea));
  } else {
    const pillH = (dockedEdge === 'left' || dockedEdge === 'right')
      ? collapsedPeekHeight
      : h;
    setWidgetBounds(collapsedBounds(dockedEdge, current, workArea, collapsedPeekWidth, widgetFullWidth, pillH, edgeArea));
  }
}

function broadcastEdgeHideState() {
  if (!widget || widget.isDestroyed()) return;
  widget.webContents.send('widget-edge-hide-changed', {
    edge: dockedEdge,
    expanded: edgeHideExpanded,
    pinned: edgeHidePinned,
    transitioning: edgeTransitioning,
  });
}

function finishEdgeTransition() {
  edgeTransitioning = false;
  broadcastEdgeHideState();
}

function waitForRendererLayout() {
  if (!widget?.webContents || widget.webContents.isDestroyed()) {
    return Promise.resolve();
  }
  return widget.webContents.executeJavaScript(`
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
  `);
}

function measureWidgetContentSize() {
  if (!widget?.webContents || widget.webContents.isDestroyed()) {
    return Promise.resolve(null);
  }
  return widget.webContents.executeJavaScript(`
    (() => {
      const app = document.querySelector('.app');
      const notch = document.querySelector('.notch');
      if (!app) return null;
      const collapsed = document.body.classList.contains('edge-collapsed');
      const side = document.body.classList.contains('edge-left')
        || document.body.classList.contains('edge-right');
      const horizontal = document.body.classList.contains('edge-top')
        || document.body.classList.contains('edge-bottom');
      const target = (collapsed && side && notch) ? notch : app;
      const rect = target.getBoundingClientRect();
      let padX = 20;
      let padY = 20;
      if (collapsed) {
        padX = 0;
        padY = 0;
      } else if (side) {
        padX = 10;
        padY = 0;
      } else if (horizontal) {
        padY = 10;
      }
      return {
        width: Math.min(640, Math.ceil(rect.width) + padX),
        height: Math.min(900, Math.ceil(rect.height) + padY),
      };
    })()
  `);
}

function applyEdgeHidePosition(expanded) {
  if (!widget || widget.isDestroyed() || !dockedEdge) return;
  edgeHideExpanded = expanded;
  if (!expanded) {
    edgeHidePinned = false;
  }

  const placeCollapsed = (measured) => {
    if (!widget || widget.isDestroyed() || !dockedEdge) return;
    const current = widget.getBounds();
    const workArea = getWidgetWorkArea(current);
    const edgeArea = getDockEdgeArea(current);
    if (measured?.height) {
      collapsedPeekHeight = Math.max(MIN_WIDGET_SIZE, Math.min(900, Math.round(measured.height)));
    }
    if (dockedEdge === 'left' || dockedEdge === 'right') {
      // Side pill width is CSS-fixed; do not trust a raced measure that still
      // saw the default 84px notch.
      collapsedPeekWidth = SIDE_PILL_WIDTH;
    }
    const pillSpan = (dockedEdge === 'left' || dockedEdge === 'right')
      ? collapsedPeekHeight
      : COLLAPSED_SIDE_HEIGHT;
    // Keep the top edge stable so rings do not jump when the window resizes.
    const next = collapsedBounds(
      dockedEdge,
      { ...current, y: current.y },
      workArea,
      (dockedEdge === 'left' || dockedEdge === 'right') ? collapsedPeekWidth : PEEK_SIZE,
      widgetFullWidth,
      pillSpan,
      edgeArea
    );
    if (dockedEdge === 'left' || dockedEdge === 'right') {
      next.y = clampDockY(current.y, next.height, workArea);
    }
    setWidgetBounds(next);
    lockDock(600);
    setTimeout(finishEdgeTransition, 120);
  };

  const placeExpanded = (measured) => {
    if (!widget || widget.isDestroyed() || !dockedEdge) return;
    if (measured?.width) {
      widgetFullWidth = Math.max(PEEK_SIZE, Math.min(640, Math.round(measured.width)));
      widgetFullHeight = Math.max(PEEK_SIZE, Math.min(900, Math.round(measured.height)));
    }
    const current = widget.getBounds();
    const workArea = getWidgetWorkArea(current);
    const edgeArea = getDockEdgeArea(current);
    // Keep the collapsed pill's top (or left for horizontal docks) so rings stay put.
    const anchor = { ...current };
    setWidgetBounds(
      expandedBounds(dockedEdge, anchor, workArea, widgetFullWidth, widgetFullHeight, edgeArea)
    );
    lockDock(1200);
    setTimeout(finishEdgeTransition, 180);
  };

  edgeTransitioning = true;
  lockDock(1500);
  broadcastEdgeHideState();

  if (!expanded && widget.webContents && !widget.webContents.isDestroyed()) {
    // Hide the flyout in the page before shrinking, or Linux keeps the old
    // width and the rings slide off the right edge.
    // Apply edge + collapsed classes here (do not wait on IPC) so measure
    // sees the side-pill CSS, not the default 84px notch.
    const edge = dockedEdge;
    widget.webContents
      .executeJavaScript(`
        (() => {
          const edge = ${JSON.stringify(edge)};
          document.body.classList.add('edge-collapsed');
          document.documentElement.classList.add('widget-edge-fill');
          for (const name of ['edge-left', 'edge-right', 'edge-top', 'edge-bottom']) {
            document.body.classList.toggle(name, name === 'edge-' + edge);
          }
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
        })()
      `)
      .then(() => measureWidgetContentSize())
      .then((size) => placeCollapsed(size))
      .catch(() => placeCollapsed(null));
    return;
  }

  if (expanded) {
    // Grow flush to the dock first so layout/measure is not clipped by the
    // collapsed peek width — that intermediate clip was shifting the notch.
    const current = widget.getBounds();
    const workArea = getWidgetWorkArea(current);
    const edgeArea = getDockEdgeArea(current);
    const provisionalW = Math.max(widgetFullWidth, 420);
    const provisionalH = Math.max(widgetFullHeight, collapsedPeekHeight, 420);
    setWidgetBounds(
      expandedBounds(dockedEdge, current, workArea, provisionalW, provisionalH, edgeArea)
    );
    waitForRendererLayout()
      .then(() => measureWidgetContentSize())
      .then((size) => placeExpanded(size))
      .catch(() => placeExpanded(null));
    return;
  }

  placeCollapsed(null);
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
  if (!widget || widget.isDestroyed() || suppressMoveHandling || edgeTransitioning) return;
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
    // Re-pin flush in case DPI/clamping drifted a few pixels off the edge.
    pinDockedWidget(widgetFullWidth, widgetFullHeight, bounds);
    persistWidgetBoundsFromExpanded();
    return;
  }
  if (action === 'dock-collapse') {
    edgeHidePinned = false;
    setDockedEdge(detectedEdge, { collapse: true, persist: true });
    return;
  }
  if (action === 'undock') {
    if (Date.now() < dockLockUntil || edgeHidePinned) {
      pinDockedWidget(widgetFullWidth, widgetFullHeight, bounds);
      return;
    }
    // Small drift after open should snap back, not float away.
    if (dockedEdge) {
      const distance = edgeDistances(bounds, workArea)[dockedEdge];
      if (typeof distance === 'number' && distance <= 120) {
        pinDockedWidget(widgetFullWidth, widgetFullHeight, bounds);
        persistWidgetBoundsFromExpanded();
        return;
      }
    }
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

function resolveDockEdge(bounds, workArea) {
  const preferred = normalizeEdge(loadSettings().widgetDockEdge);
  if (preferred) return preferred;
  return preferDockEdge(bounds, workArea);
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
  setDockedEdge(resolveDockEdge(bounds, workArea), { collapse: true, persist: true });
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
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  widgetFullWidth = DEFAULT_FULL_WIDTH;
  widgetFullHeight = DEFAULT_FULL_HEIGHT;
  widget.setAlwaysOnTop(true, 'floating');
  widget.setMinimumSize(MIN_WIDGET_SIZE, MIN_WIDGET_SIZE);
  widget.setMaximumSize(640, 900);
  // Click-through on transparent pixels; renderer re-enables over notch/flyout.
  widget.setIgnoreMouseEvents(true, { forward: true });
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
            const edgeArea = getDockEdgeArea(bounds);
            const pos = expandedBounds(
              dockedEdge,
              bounds,
              workArea,
              widgetFullWidth,
              widgetFullHeight,
              edgeArea
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
  if (partial.widgetDockEdge !== undefined && dockedEdge && widget && !widget.isDestroyed()) {
    const preferred = normalizeEdge(settings.widgetDockEdge);
    if (preferred && preferred !== dockedEdge) {
      setDockedEdge(preferred, { collapse: !edgeHideExpanded, persist: true, pinned: edgeHidePinned });
    }
  }
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

ipcMain.on('widget-set-ignore-mouse', (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== widget || win.isDestroyed()) return;
  // Never ignore input while the user is dragging the widget.
  if (widgetDrag) return;
  // Collapsed side pill is the whole hit target — do not click-through.
  if (ignore && !edgeHideExpanded && (dockedEdge === 'left' || dockedEdge === 'right')) {
    win.setIgnoreMouseEvents(false);
    return;
  }
  if (ignore) {
    win.setIgnoreMouseEvents(true, { forward: true });
  } else {
    win.setIgnoreMouseEvents(false);
  }
});

ipcMain.on('widget-drag-start', (event, point) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== widget || win.isDestroyed()) return;
  if (!point || typeof point.screenX !== 'number' || typeof point.screenY !== 'number') return;

  win.setIgnoreMouseEvents(false);
  suppressMoveHandling = true;

  // Pulling the pill off an edge means the user is repositioning it.
  if (dockedEdge) {
    setDockedEdge(null, { persist: true });
  }

  const [wx, wy] = win.getPosition();
  widgetDrag = {
    offsetX: point.screenX - wx,
    offsetY: point.screenY - wy,
  };
});

ipcMain.on('widget-drag-move', (event, point) => {
  if (!widgetDrag || !widget || widget.isDestroyed()) return;
  if (!point || typeof point.screenX !== 'number' || typeof point.screenY !== 'number') return;
  widget.setPosition(
    Math.round(point.screenX - widgetDrag.offsetX),
    Math.round(point.screenY - widgetDrag.offsetY),
    false
  );
});

ipcMain.on('widget-drag-end', () => {
  if (!widget || widget.isDestroyed()) {
    widgetDrag = null;
    return;
  }
  widgetDrag = null;
  suppressMoveHandling = false;
  scheduleSnapEvaluation();
  scheduleWidgetBoundsSave();
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
  if (win === widget && edgeTransitioning) return;

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

  const clampedH = Math.max(MIN_WIDGET_SIZE, Math.min(900, Math.round(nextHeight)));
  const clampedW = Math.max(MIN_WIDGET_SIZE, Math.min(640, Math.round(nextWidth)));

  if (win === widget && dockedEdge) {
    pinDockedWidget(clampedW, clampedH, current);
    return;
  }

  if (win === widget) {
    const workArea = getWidgetWorkArea(current);
    widgetFullHeight = clampedH;
    widgetFullWidth = clampedW;

    // Keep the notch (right edge of the window) still when the flyout opens.
    let x = current.x + current.width - clampedW;
    let y = current.y;
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
