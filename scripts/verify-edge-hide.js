/**
 * Local smoke verification for left/right/top edge hide.
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

    const mid = {
      x: workArea.x + Math.floor(workArea.width / 2) - 150,
      y: workArea.y + 120,
      width: DEFAULT_FULL_WIDTH,
      height: DEFAULT_FULL_HEIGHT,
    };
    assert(detectSnapEdge(mid, workArea) === null, 'center position does not snap');
    assert(preferDockEdge(mid, workArea) === 'top', 'center prefers top (tie-break)');

    assert(detectSnapEdge({ ...mid, y: workArea.y + 8 }, workArea) === 'top', 'near-top snaps to top');
    assert(detectSnapEdge({ ...mid, x: workArea.x + 8 }, workArea) === 'left', 'near-left snaps to left');
    assert(
      detectSnapEdge({ ...mid, x: workArea.x + workArea.width - DEFAULT_FULL_WIDTH - 8 }, workArea) === 'right',
      'near-right snaps to right'
    );

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

    win.setBounds(mid, false);
    await sleep(300);
    await capture(win, '01-floating-center');
    assert(win.isVisible(), 'widget visible at center');

    for (const edge of ['top', 'left', 'right']) {
      const expanded = expandedBounds(edge, mid, workArea, DEFAULT_FULL_WIDTH, DEFAULT_FULL_HEIGHT);
      const collapsed = collapsedBounds(edge, mid, workArea, PEEK_SIZE, DEFAULT_FULL_WIDTH, DEFAULT_FULL_HEIGHT);
      assert(fullyInside(collapsed, workArea), `collapsed ${edge} stays inside same workArea`);
      if (edge === 'top') {
        assert(collapsed.height === PEEK_SIZE, `collapsed top height is peek (${collapsed.height})`);
        assert(collapsed.width === DEFAULT_FULL_WIDTH, 'collapsed top keeps full width');
        approx(collapsed.y, workArea.y, 1, 'collapsed top y is workArea top');
      } else {
        assert(collapsed.width === PEEK_SIZE, `collapsed ${edge} width is peek (${collapsed.width})`);
        assert(collapsed.height === DEFAULT_FULL_HEIGHT, `collapsed ${edge} keeps full height`);
        if (edge === 'left') {
          approx(collapsed.x, workArea.x, 1, 'collapsed left x is workArea left');
        } else {
          approx(collapsed.x, workArea.x + workArea.width - PEEK_SIZE, 1, 'collapsed right x is workArea right');
        }
      }

      win.setBounds(expanded, false);
      await sleep(250);
      await capture(win, `02-docked-expanded-${edge}`);

      win.setBounds(collapsed, false);
      await sleep(250);
      const collapsedActual = win.getBounds();
      assert(fullyInside(collapsedActual, workArea), `actual collapsed ${edge} remains on same monitor`);
      await capture(win, `03-docked-collapsed-${edge}`);

      win.setBounds(expanded, false);
      await sleep(250);
      await capture(win, `04-revealed-expanded-${edge}`);
    }

    assert(
      isCursorNearDock('left', { x: workArea.x + 10, y: mid.y + 20 }, workArea, { ...mid, x: workArea.x, width: PEEK_SIZE }, DEFAULT_FULL_WIDTH, DEFAULT_FULL_HEIGHT),
      'cursor near left dock detected'
    );
    assert(
      !isCursorNearDock('right', { x: workArea.x + 10, y: mid.y + 20 }, workArea, { ...mid, x: workArea.x + workArea.width - PEEK_SIZE, width: PEEK_SIZE }, DEFAULT_FULL_WIDTH, DEFAULT_FULL_HEIGHT),
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
