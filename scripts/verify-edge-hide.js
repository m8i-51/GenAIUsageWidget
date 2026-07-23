/**
 * Local smoke verification for PC Manager-style edge hide.
 * Run: npx electron scripts/verify-edge-hide.js
 */
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  detectSnapEdge,
  nearestHorizontalEdge,
  expandedBounds,
  collapsedBounds,
  isCursorNearDock,
  PEEK_SIZE,
  DEFAULT_FULL_WIDTH,
} = require('../src/widget-edge-hide');

const OUT_DIR = process.env.VERIFY_OUT_DIR || '/opt/cursor/artifacts/edge-hide-verify';
const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT: ${message}`);
  }
  results.push(`ok - ${message}`);
  console.log(`ok - ${message}`);
}

function approx(actual, expected, tol, label) {
  assert(Math.abs(actual - expected) <= tol, `${label} (actual=${actual}, expected≈${expected}, tol=${tol})`);
}

async function capture(win, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const img = await win.webContents.capturePage();
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  console.log(`saved ${file}`);
  return file;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fullyInside(bounds, workArea) {
  return (
    bounds.x >= workArea.x - 1
    && bounds.y >= workArea.y - 1
    && bounds.x + bounds.width <= workArea.x + workArea.width + 1
    && bounds.y + bounds.height <= workArea.y + workArea.height + 1
  );
}

app.whenReady().then(async () => {
  try {
    ipcMain.handle('get-settings', () => ({
      compactMode: false,
      hiddenProviders: [],
      widgetBounds: null,
      widgetEdgeHide: null,
    }));
    ipcMain.handle('set-settings', (_e, partial) => ({
      compactMode: false,
      hiddenProviders: [],
      widgetBounds: null,
      widgetEdgeHide: null,
      ...partial,
    }));
    ipcMain.handle('get-claude-usage', async () => ({ error: 'not configured' }));
    ipcMain.handle('get-codex-usage', async () => ({ error: 'not configured' }));
    ipcMain.handle('get-cursor-usage', async () => ({ error: 'not configured' }));
    ipcMain.handle('get-antigravity-usage', async () => ({ error: 'not configured' }));
    ipcMain.on('resize-to', () => {});

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    assert(workArea.width > 0 && workArea.height > 0, `workArea available (${workArea.width}x${workArea.height})`);

    const win = new BrowserWindow({
      width: DEFAULT_FULL_WIDTH,
      height: 360,
      show: true,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'preload.js'),
        contextIsolation: true,
      },
    });

    win.setAlwaysOnTop(true, 'floating');
    await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'), { query: { mode: 'widget' } });
    await sleep(1000);

    const mid = {
      x: workArea.x + Math.floor(workArea.width / 2) - 150,
      y: workArea.y + 40,
      width: DEFAULT_FULL_WIDTH,
      height: 360,
    };
    assert(detectSnapEdge(mid, workArea) === null, 'center position does not snap');

    const nearRight = { ...mid, x: workArea.x + workArea.width - DEFAULT_FULL_WIDTH - 10 };
    assert(detectSnapEdge(nearRight, workArea) === 'right', 'near-right snaps to right');
    assert(nearestHorizontalEdge(nearRight, workArea) === 'right', 'nearest edge is right');

    const nearLeft = { ...mid, x: workArea.x + 8 };
    assert(detectSnapEdge(nearLeft, workArea) === 'left', 'near-left snaps to left');

    win.setBounds(mid, false);
    await sleep(300);
    await capture(win, '01-floating-center');
    assert(win.isVisible(), 'widget visible at center');

    const expanded = expandedBounds('right', mid, workArea, DEFAULT_FULL_WIDTH);
    const collapsed = collapsedBounds('right', mid, workArea, PEEK_SIZE);
    assert(fullyInside(collapsed, workArea), 'collapsed right stays inside same workArea (no sub-monitor slide)');
    assert(collapsed.width === PEEK_SIZE, `collapsed width is peek (${collapsed.width})`);

    win.setBounds(expanded, false);
    await sleep(300);
    await capture(win, '02-docked-expanded-right');

    win.setBounds(collapsed, false);
    await sleep(300);
    const collapsedActual = win.getBounds();
    assert(fullyInside(collapsedActual, workArea), 'actual collapsed right remains on same monitor');
    approx(collapsedActual.width, PEEK_SIZE, 8, 'actual collapsed width');
    await capture(win, '03-docked-collapsed-right');

    win.setBounds(expanded, false);
    await sleep(300);
    const expandedActual = win.getBounds();
    approx(expandedActual.x, workArea.x + workArea.width - DEFAULT_FULL_WIDTH, 8, 'expanded flush right');
    await capture(win, '04-revealed-expanded-right');

    const leftCollapsed = collapsedBounds('left', mid, workArea, PEEK_SIZE);
    assert(fullyInside(leftCollapsed, workArea), 'collapsed left stays inside same workArea');
    win.setBounds(leftCollapsed, false);
    await sleep(300);
    await capture(win, '05-docked-collapsed-left');

    assert(
      isCursorNearDock('right', { x: workArea.x + workArea.width - 10, y: mid.y + 20 }, workArea, collapsed, DEFAULT_FULL_WIDTH),
      'cursor near right dock detected'
    );
    assert(
      !isCursorNearDock('right', { x: workArea.x + 100, y: mid.y + 20 }, workArea, collapsed, DEFAULT_FULL_WIDTH),
      'cursor far from right dock not detected'
    );

    win.setBounds(mid, false);
    await sleep(200);
    const hideVisible = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.getElementById('hide-edge-btn');
        if (!btn) return false;
        return window.getComputedStyle(btn).display !== 'none';
      })()
    `);
    assert(hideVisible === true, 'hide-edge button visible in widget mode');

    let hideIpcReceived = false;
    ipcMain.once('widget-hide-to-edge', () => {
      hideIpcReceived = true;
    });
    await win.webContents.executeJavaScript(`window.api.hideWidgetToEdge()`);
    await sleep(150);
    assert(hideIpcReceived, 'hideWidgetToEdge IPC reaches main');

    let hoverIpc = null;
    ipcMain.once('widget-edge-hide-hover', (_e, hovering) => {
      hoverIpc = hovering;
    });
    await win.webContents.executeJavaScript(`window.api.setWidgetEdgeHover(true)`);
    await sleep(150);
    assert(hoverIpc === true, 'setWidgetEdgeHover(true) IPC reaches main');

    const summary = {
      ok: true,
      workArea,
      peekSize: PEEK_SIZE,
      collapsedRight: collapsed,
      checks: results,
      outDir: OUT_DIR,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log('\nVERIFY PASSED');
    console.log(JSON.stringify(summary, null, 2));
    app.exit(0);
  } catch (err) {
    console.error('\nVERIFY FAILED:', err.message);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, 'summary.json'),
      JSON.stringify({ ok: false, error: err.message, checks: results }, null, 2)
    );
    app.exit(1);
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
