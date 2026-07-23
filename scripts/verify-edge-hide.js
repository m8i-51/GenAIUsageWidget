/**
 * Local smoke verification for top-edge hide.
 * Run: npx electron scripts/verify-edge-hide.js
 */
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  detectSnapEdge,
  preferDockEdge,
  expandedBounds,
  collapsedBounds,
  isCursorNearDock,
  PEEK_SIZE,
  DEFAULT_FULL_WIDTH,
  DEFAULT_FULL_HEIGHT,
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
    assert(preferDockEdge() === 'top', 'preferred dock edge is top');

    const win = new BrowserWindow({
      width: DEFAULT_FULL_WIDTH,
      height: DEFAULT_FULL_HEIGHT,
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
      y: workArea.y + 120,
      width: DEFAULT_FULL_WIDTH,
      height: DEFAULT_FULL_HEIGHT,
    };
    assert(detectSnapEdge(mid, workArea) === null, 'center position does not snap');

    const nearTop = { ...mid, y: workArea.y + 8 };
    assert(detectSnapEdge(nearTop, workArea) === 'top', 'near-top snaps to top');

    win.setBounds(mid, false);
    await sleep(300);
    await capture(win, '01-floating-center');
    assert(win.isVisible(), 'widget visible at center');

    const expanded = expandedBounds('top', mid, workArea, DEFAULT_FULL_WIDTH, DEFAULT_FULL_HEIGHT);
    const collapsed = collapsedBounds('top', mid, workArea, PEEK_SIZE, DEFAULT_FULL_WIDTH);
    assert(fullyInside(collapsed, workArea), 'collapsed top stays inside same workArea');
    assert(collapsed.height === PEEK_SIZE, `collapsed height is peek (${collapsed.height})`);
    assert(collapsed.width === DEFAULT_FULL_WIDTH, 'collapsed keeps full width');
    approx(collapsed.y, workArea.y, 1, 'collapsed y is workArea top');

    win.setBounds(expanded, false);
    await sleep(300);
    await capture(win, '02-docked-expanded-top');

    win.setBounds(collapsed, false);
    await sleep(300);
    const collapsedActual = win.getBounds();
    assert(fullyInside(collapsedActual, workArea), 'actual collapsed top remains on same monitor');
    approx(collapsedActual.height, PEEK_SIZE, 8, 'actual collapsed height');
    await capture(win, '03-docked-collapsed-top');

    win.setBounds(expanded, false);
    await sleep(300);
    const expandedActual = win.getBounds();
    approx(expandedActual.y, workArea.y, 8, 'expanded flush top');
    await capture(win, '04-revealed-expanded-top');

    assert(
      isCursorNearDock('top', { x: mid.x + 20, y: workArea.y + 10 }, workArea, collapsed, DEFAULT_FULL_WIDTH, DEFAULT_FULL_HEIGHT),
      'cursor near top dock detected'
    );
    assert(
      !isCursorNearDock('top', { x: mid.x + 20, y: workArea.y + 400 }, workArea, collapsed, DEFAULT_FULL_WIDTH, DEFAULT_FULL_HEIGHT),
      'cursor far from top dock not detected'
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

    let showIpcReceived = false;
    ipcMain.once('widget-show-from-edge', () => {
      showIpcReceived = true;
    });
    await win.webContents.executeJavaScript(`window.api.showWidgetFromEdge()`);
    await sleep(150);
    assert(showIpcReceived, 'showWidgetFromEdge IPC reaches main (click-to-open)');

    const hoverApiMissing = await win.webContents.executeJavaScript(
      `typeof window.api.setWidgetEdgeHover === 'undefined'`
    );
    assert(hoverApiMissing === true, 'setWidgetEdgeHover is removed (no hover preview)');

    const summary = {
      ok: true,
      workArea,
      peekSize: PEEK_SIZE,
      collapsedTop: collapsed,
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
