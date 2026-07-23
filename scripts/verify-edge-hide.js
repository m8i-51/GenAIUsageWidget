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
  expandedPosition,
  collapsedPosition,
  PEEK_SIZE,
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

function visiblePeekRight(bounds, workArea) {
  return (workArea.x + workArea.width) - bounds.x;
}

function visiblePeekLeft(bounds, workArea) {
  return (bounds.x + bounds.width) - workArea.x;
}

app.whenReady().then(async () => {
  try {
    // Minimal stubs so the shared renderer can boot without the full main process.
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
      width: 300,
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
      width: 300,
      height: 360,
    };
    assert(detectSnapEdge(mid, workArea) === null, 'center position does not snap');

    const nearRight = { ...mid, x: workArea.x + workArea.width - 300 - 10 };
    assert(detectSnapEdge(nearRight, workArea) === 'right', 'near-right snaps to right');
    assert(nearestHorizontalEdge(nearRight, workArea) === 'right', 'nearest edge is right');

    const nearLeft = { ...mid, x: workArea.x + 8 };
    assert(detectSnapEdge(nearLeft, workArea) === 'left', 'near-left snaps to left');

    win.setPosition(mid.x, mid.y, false);
    await sleep(300);
    await capture(win, '01-floating-center');
    assert(win.isVisible(), 'widget visible at center');

    const edge = 'right';
    const bounds = win.getBounds();
    const expanded = expandedPosition(edge, bounds, workArea);
    const collapsed = collapsedPosition(edge, bounds, workArea);
    win.setPosition(expanded.x, expanded.y, false);
    await sleep(300);
    await capture(win, '02-docked-expanded-right');

    win.setPosition(collapsed.x, collapsed.y, false);
    await sleep(300);
    const collapsedBounds = win.getBounds();
    // Some WMs clamp off-screen windows; accept a small peek range.
    const rightPeek = visiblePeekRight(collapsedBounds, workArea);
    assert(rightPeek > 0 && rightPeek <= 48, `collapsed right peek visible (${rightPeek}px)`);
    assert(collapsedBounds.x + collapsedBounds.width > workArea.x + workArea.width, 'collapsed right extends past workArea');
    await capture(win, '03-docked-collapsed-right');

    win.setPosition(expanded.x, expanded.y, false);
    await sleep(300);
    const expandedBounds = win.getBounds();
    approx(expandedBounds.x, workArea.x + workArea.width - expandedBounds.width, 8, 'expanded flush right');
    await capture(win, '04-revealed-expanded-right');

    const leftCollapsed = collapsedPosition('left', bounds, workArea);
    win.setPosition(leftCollapsed.x, leftCollapsed.y, false);
    await sleep(300);
    const leftBounds = win.getBounds();
    const leftPeek = visiblePeekLeft(leftBounds, workArea);
    assert(leftPeek > 0 && leftPeek <= 48, `collapsed left peek visible (${leftPeek}px)`);
    assert(leftBounds.x < workArea.x, 'collapsed left extends past workArea');
    await capture(win, '05-docked-collapsed-left');

    win.setPosition(mid.x, mid.y, false);
    await sleep(200);
    const hideVisible = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.getElementById('hide-edge-btn');
        if (!btn) return false;
        const style = window.getComputedStyle(btn);
        return style.display !== 'none';
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
      rightPeek,
      leftPeek,
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
