/**
 * Capture README screenshots from the real widget/popup UI + demo usage data.
 * Run: npm run screenshots
 *
 * Writes docs/screenshots/*.png
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const demo = require('../src/demo-usage');

app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.disableHardwareAcceleration();

const OUT_DIR = process.env.SCREENSHOT_OUT_DIR
  || path.join(__dirname, '..', 'docs', 'screenshots');
const STAMP = 'Updated 9:41 AM';

const settings = {
  compactMode: false,
  hiddenProviders: [],
  widgetBounds: null,
  widgetEdgeHide: null,
  widgetDockEdge: 'right',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installIpc() {
  ipcMain.handle('get-settings', () => ({ ...settings }));
  ipcMain.handle('set-settings', (_e, partial) => {
    Object.assign(settings, partial || {});
    return { ...settings };
  });
  ipcMain.handle('get-claude-usage', () => demo.claude());
  ipcMain.handle('get-codex-usage', () => demo.codex());
  ipcMain.handle('get-cursor-usage', () => demo.cursor());
  ipcMain.handle('get-antigravity-usage', () => demo.antigravity());
  ipcMain.on('resize-to', () => {
    // Ignore renderer-driven resizes (they cap at 900px). The capture
    // script sizes the window from the measured .app box instead.
  });
  ipcMain.on('save-widget-bounds', () => {});
  ipcMain.on('widget-hide-to-edge', () => {});
  ipcMain.on('widget-show-from-edge', () => {});
  ipcMain.on('widget-set-ignore-mouse', () => {});
  ipcMain.on('widget-drag-start', () => {});
  ipcMain.on('widget-drag-move', () => {});
  ipcMain.on('widget-drag-end', () => {});
}

function createUiWindow({ widget }) {
  const win = new BrowserWindow({
    width: widget ? 480 : 400,
    height: widget ? 560 : 1100,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  return win;
}

async function loadUi(win, { widget }) {
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'), {
    query: widget ? { mode: 'widget' } : {},
  });
}

async function waitForReady(win, { widget }) {
  await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const ok = ${widget ? `
          document.getElementById('claude-value')?.textContent?.includes('%')
        ` : `
          document.querySelector('#claude-detail .meter')
            && document.querySelector('#cursor-detail .meter')
        `};
        if (ok) {
          resolve(true);
          return;
        }
        if (Date.now() - start > 10000) {
          reject(new Error('UI did not finish loading demo usage'));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  `);
}

async function stampUpdated(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const stamp = ${JSON.stringify(STAMP)};
      const updated = document.getElementById('last-updated');
      if (updated) updated.textContent = stamp;
      const flyoutUpdated = document.querySelector('.flyout-updated');
      if (flyoutUpdated) flyoutUpdated.textContent = stamp;
    })()
  `);
}

async function measureApp(win, pad = 12) {
  return win.webContents.executeJavaScript(`
    (() => {
      const app = document.querySelector('.app');
      const r = app.getBoundingClientRect();
      const pad = ${pad};
      return {
        x: Math.max(0, Math.floor(r.x) - pad),
        y: Math.max(0, Math.floor(r.y) - pad),
        width: Math.ceil(r.width) + pad * 2,
        height: Math.ceil(r.height) + pad * 2,
        contentWidth: Math.ceil(r.width),
        contentHeight: Math.ceil(r.height),
      };
    })()
  `);
}

async function fitToApp(win) {
  const size = await measureApp(win, 16);
  win.setContentSize(
    Math.max(80, Math.min(720, size.contentWidth + 32)),
    Math.max(80, Math.min(1400, size.contentHeight + 32))
  );
  await sleep(200);
}

async function captureApp(win, destPath) {
  await fitToApp(win);
  await sleep(150);
  const rect = await measureApp(win, 10);
  const img = await win.webContents.capturePage({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, img.toPNG());
  const { width, height } = img.getSize();
  console.log(`wrote ${destPath} (${width}x${height}, app ${rect.contentWidth}x${rect.contentHeight})`);
  return destPath;
}

async function captureWidgetFlyout() {
  const win = createUiWindow({ widget: true });
  await loadUi(win, { widget: true });
  await waitForReady(win, { widget: true });
  win.webContents.send('widget-edge-hide-changed', {
    edge: 'right',
    expanded: true,
    pinned: true,
    transitioning: false,
  });
  await sleep(250);
  await stampUpdated(win);
  const hidden = await win.webContents.executeJavaScript(`
    !!document.getElementById('flyout')?.hidden
  `);
  if (hidden) {
    await win.webContents.executeJavaScript(`
      document.getElementById('claude-provider')?.click()
    `);
    await sleep(200);
    await stampUpdated(win);
  }
  await sleep(600);
  await captureApp(win, path.join(OUT_DIR, 'widget-flyout.png'));
  win.close();
}

async function captureTrayPopup() {
  const win = createUiWindow({ widget: false });
  await loadUi(win, { widget: false });
  await waitForReady(win, { widget: false });
  await stampUpdated(win);
  await sleep(400);
  await captureApp(win, path.join(OUT_DIR, 'tray-popup.png'));
  win.close();
}

app.whenReady().then(async () => {
  try {
    installIpc();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await captureWidgetFlyout();
    await captureTrayPopup();
    console.log('SCREENSHOTS OK');
    app.exit(0);
  } catch (err) {
    console.error('SCREENSHOTS FAILED:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
