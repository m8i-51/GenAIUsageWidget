// Renders the Elgato Marketplace images (thumbnail, gallery, app icon) with
// headless Edge. Keys are drawn by the plugin's own renderKey(), and the
// settings screenshot is the real Property Inspector page.
//
// Usage (Windows): node marketplace/render.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { renderKey } from '../src/key-image.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'images');
const work = path.join(here, '.work');
const sdPlugin = path.join(here, '..', 'com.github.m8i-51.genaiusage.sdPlugin');
const edge = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(work, { recursive: true });

// A fixed clock keeps the countdowns in the images stable between renders.
const NOW = Date.parse('2026-10-27T12:00:00Z');
const at = (minutes) => new Date(NOW + minutes * 60 * 1000).toISOString();
const key = (props, size = 220) => `<div class="key" style="width:${size}px;height:${size}px">${renderKey({ now: NOW, ...props })}</div>`;

function shoot(name, html, width, height, dir = out) {
  const file = path.join(work, `${name}.html`);
  fs.writeFileSync(file, html);
  const png = path.join(dir, `${name}.png`);
  fs.rmSync(png, { force: true });
  execFileSync(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${width},${height}`,
    `--screenshot=${png}`, pathToFileURL(file).href,
  ], { stdio: 'ignore' });
  waitForFile(png);
  console.log(`${png}`);
}

// Edge's launcher can return before the screenshot is on disk.
function waitForFile(file) {
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let lastSize = -1;
  for (let i = 0; i < 100; i++) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size > 0 && size === lastSize) return;
    lastSize = size;
    sleep(200);
  }
  throw new Error(`Edge did not write ${file}`);
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; width: 1920px; height: 960px; overflow: hidden; font-family: 'Segoe UI', sans-serif; color: #f5f5f5;
    background: radial-gradient(1200px 700px at 75% 40%, #1b1d22 0%, #0b0b0c 70%); }
  .key { border-radius: 30px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.06); flex: none; }
  .key svg { width: 100%; height: 100%; display: block; }
  h1 { font-size: 76px; font-weight: 800; margin: 0; letter-spacing: -1px; }
  p.sub { font-size: 34px; color: #a3a3a3; margin: 22px 0 0; line-height: 1.35; }
  .page { position: absolute; inset: 0; padding: 110px 130px; }
  .caption { font-size: 26px; color: #a3a3a3; text-align: center; margin-top: 18px; }
  .arrow { font-size: 34px; color: #a3a3a3; text-align: center; font-weight: 600; }
`;

const page = (body, extraCss = '') => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}${extraCss}</style></head><body>${body}</body></html>`;

// Property Inspector screenshot: the real page with a fake Stream Deck socket.
function inspectorShot() {
  const source = fs.readFileSync(path.join(sdPlugin, 'ui', 'limit.html'), 'utf8');
  const mock = `<script>
    window.WebSocket = class {
      constructor() { setTimeout(() => this.onopen && this.onopen(), 0); }
      send(raw) {
        const m = JSON.parse(raw);
        if (m.event === 'sendToPlugin') setTimeout(() => this.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: {
          event: 'limits', provider: 'claude', loaded: true, via: 'widget',
          providers: ${JSON.stringify(Object.entries({ claude: 'Claude', codex: 'Codex', cursor: 'Cursor', antigravity: 'Antigravity', copilot: 'Copilot', gemini: 'Gemini', windsurf: 'Windsurf', kiro: 'Kiro', zai: 'z.ai' }).map(([id, label]) => ({ id, label })))},
          limits: [{ id: 'session', label: '5h' }, { id: 'week', label: 'Week' }] } }) }), 0);
      }
    };
  </script>`;
  const start = `<script>connectElgatoStreamDeckSocket(0, 'ctx', 'registerPropertyInspector',
    JSON.stringify({ application: { language: 'en' } }),
    JSON.stringify({ action: 'com.github.m8i-51.genaiusage.limit', payload: { settings: { provider: 'claude', limit: 'session' } } }));</script>`;
  const html = source.replace('<head>', `<head>${mock}`).replace('</body>', `${start}</body>`)
    .replace('body {', 'html { zoom: 2; } body {');
  shoot('inspector-raw', html, 760, 360, work);
  return pathToFileURL(path.join(work, 'inspector-raw.png')).href;
}

// Thumbnail
shoot('thumbnail', page(`
  <div class="page" style="display:flex;align-items:center;gap:110px">
    <div style="flex:1">
      <h1 style="font-size:104px">GenAI Usage</h1>
      <p class="sub" style="font-size:40px">AI coding usage limits on your<br>Stream Deck keys</p>
      <p class="sub" style="font-size:28px;margin-top:40px;color:#737373">Claude · Codex · Cursor · Copilot · Gemini · Antigravity · Windsurf · Kiro · z.ai</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,220px);gap:30px">
      ${key({ title: 'Claude · 5h', status: 'ok', percent: 25 })}
      ${key({ title: 'Claude · Week', status: 'ok', percent: 58 })}
      ${key({ title: 'Codex · 5h', status: 'ok', percent: 12 })}
      ${key({ title: 'Cursor · Week', status: 'ok', percent: 91 })}
      ${key({ title: 'Copilot · Premium', status: 'ok', percent: 38 })}
      ${key({ title: 'Claude · 5h', status: 'ok', percent: 25, view: 'reset', resetsAt: at(134) })}
    </div>
  </div>`), 1920, 960);

// 1. One limit per key
shoot('gallery-1-limits', page(`
  <div class="page">
    <h1>One limit per key</h1>
    <p class="sub">Each key fills like a water level and turns orange at 45% and red at 70%.</p>
    <div style="display:flex;gap:44px;justify-content:center;margin-top:110px">
      ${[
        { title: 'Claude · 5h', percent: 25 }, { title: 'Codex · Week', percent: 47 },
        { title: 'Cursor · Week', percent: 91 }, { title: 'Gemini · Pro', percent: 12 },
        { title: 'Copilot · Premium', percent: 73 },
      ].map((k) => `<div>${key({ status: 'ok', ...k }, 260)}</div>`).join('')}
    </div>
  </div>`), 1920, 960);

// 2. Press and hold
shoot('gallery-2-press', page(`
  <div class="page">
    <h1>Press for the reset time</h1>
    <p class="sub">Press a key to see when the limit resets; it switches back after 10 seconds.<br>Hold it to refresh right away.</p>
    <div style="display:flex;gap:70px;align-items:center;justify-content:center;margin-top:90px">
      ${key({ title: 'Claude · 5h', status: 'ok', percent: 73 }, 300)}
      <div class="arrow">Press<br><span style="font-size:60px">→</span></div>
      ${key({ title: 'Claude · 5h', status: 'ok', percent: 73, view: 'reset', resetsAt: at(51) }, 300)}
      <div style="width:60px"></div>
      ${key({ title: 'Codex · Week', status: 'ok', percent: 47, view: 'reset', resetsAt: at(3 * 24 * 60 + 4 * 60) }, 300)}
    </div>
  </div>`), 1920, 960);

// 3. Settings
const inspector = inspectorShot();
shoot('gallery-3-settings', page(`
  <div class="page">
    <h1>Pick any provider and limit</h1>
    <p class="sub">Limits come from your account's latest data, so model-specific caps show up by name.</p>
    <div style="display:flex;gap:80px;align-items:center;justify-content:center;margin-top:80px">
      <img src="${inspector}" style="width:760px;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.55)">
      ${key({ title: 'Claude · 5h', status: 'ok', percent: 25 }, 300)}
    </div>
  </div>`), 1920, 960);

// 4. Closest limit
shoot('gallery-4-closest', page(`
  <div class="page">
    <h1>Closest Limit</h1>
    <p class="sub">A second action that always shows whichever limit is nearest its cap.</p>
    <div style="display:flex;gap:40px;align-items:center;justify-content:center;margin-top:100px">
      ${key({ title: 'Claude · 5h', status: 'ok', percent: 40 }, 210)}
      ${key({ title: 'Codex · 5h', status: 'ok', percent: 81 }, 210)}
      ${key({ title: 'Cursor · Week', status: 'ok', percent: 20 }, 210)}
      <div class="arrow" style="margin:0 30px"><span style="font-size:60px">→</span></div>
      ${key({ title: 'Codex · 5h', status: 'ok', percent: 81 }, 300)}
    </div>
  </div>`), 1920, 960);

// 5. Standalone or with the widget
shoot('gallery-5-sources', page(`
  <div class="page">
    <h1>Works on its own</h1>
    <p class="sub">Keys read the sign-ins already on this PC. When GenAIUsageWidget is running,<br>they reuse its numbers, so providers are never polled twice.</p>
    <div style="display:flex;gap:44px;justify-content:center;margin-top:90px">
      ${key({ title: 'Claude · Week', status: 'ok', percent: 58, stale: true }, 240)}
      ${key({ title: 'Gemini · Pro', status: 'signin' }, 240)}
      ${key({ title: 'z.ai · 5h', status: 'needsWidget' }, 240)}
      ${key({ title: 'Closest limit', status: 'none' }, 240)}
    </div>
    <div style="display:flex;gap:44px;justify-content:center">
      ${['Last good data while offline', 'Not signed in on this PC', 'z.ai needs the widget', 'Nothing signed in yet']
        .map((c) => `<div class="caption" style="width:240px">${c}</div>`).join('')}
    </div>
  </div>`), 1920, 960);

// App icon (288 x 288)
const icon = fs.readFileSync(path.join(sdPlugin, 'imgs', 'plugin.svg'), 'utf8').replace('width="512" height="512"', 'width="288" height="288"');
shoot('app-icon', `<!DOCTYPE html><html><body style="margin:0;background:transparent">${icon}</body></html>`, 800, 800);
// Edge has a minimum window size, so crop the icon down to exactly 288 x 288.
execFileSync('powershell', ['-NoProfile', '-Command', `
  Add-Type -AssemblyName System.Drawing
  $p = '${path.join(out, 'app-icon.png')}'
  $src = [System.Drawing.Bitmap]::FromFile($p)
  $dst = New-Object System.Drawing.Bitmap 288, 288, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $r = New-Object System.Drawing.Rectangle 0, 0, 288, 288
  $g.DrawImage($src, $r, $r, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $src.Dispose()
  $dst.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)`]);
