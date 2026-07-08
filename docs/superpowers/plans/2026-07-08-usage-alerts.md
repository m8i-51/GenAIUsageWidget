# 使用量アラート Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定済みプロバイダの使用量が 70% / 90% を超えたとき OS ネイティブ通知を表示し、トレイメニューから ON/OFF できるようにする。

**Architecture:** `renderer.js` が各カード更新後に正規化スナップショットを IPC `report-usage` で main に送る。新設の `src/alerts.js` がヒステリシス付き状態マシンで重複を防ぎ Electron `Notification` を発火する。設定は `src/settings.js` で `userData/settings.json` に永続化。

**Tech Stack:** Electron 32 (`Notification` API), Node.js fs, 既存 IPC (preload + main)

**Spec:** [2026-07-08-usage-alerts-design.md](../specs/2026-07-08-usage-alerts-design.md)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/settings.js` | Create | `alertsEnabled` 読み書き |
| `src/alerts.js` | Create | 閾値判定・ヒステリシス・通知 |
| `src/main.js` | Modify | IPC ハンドラ、トレイメニュー |
| `src/preload.js` | Modify | `reportUsage` 公開 |
| `src/renderer.js` | Modify | 各カード更新後にスナップショット報告 |
| `README.md` | Modify | 機能説明追記 |
| `README.ja.md` | Modify | 機能説明追記（日本語） |

---

### Task 1: 設定モジュール

**Files:**
- Create: `src/settings.js`

- [ ] **Step 1: `src/settings.js` を作成**

```javascript
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = { alertsEnabled: true };

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(partial) {
  const next = { ...load(), ...partial };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

function isAlertsEnabled() {
  return load().alertsEnabled;
}

function setAlertsEnabled(enabled) {
  return save({ alertsEnabled: enabled });
}

module.exports = { isAlertsEnabled, setAlertsEnabled, load };
```

- [ ] **Step 2: 動作確認**

Run: `node -e "const s=require('./src/settings'); console.log(typeof s.isAlertsEnabled)"`  
Expected: `function`（Electron 未起動時は `app.getPath` で失敗するため、Step 1 の構文チェックのみでも可）

- [ ] **Step 3: Commit**

```bash
git add src/settings.js
git commit -m "feat: add settings module for usage alert preferences"
```

---

### Task 2: アラート状態マシン

**Files:**
- Create: `src/alerts.js`

- [ ] **Step 1: `src/alerts.js` を作成**

```javascript
const { Notification } = require('electron');

const WARNING_ENTER = 70;
const WARNING_EXIT = 65;
const CRITICAL_ENTER = 90;
const CRITICAL_EXIT = 85;

const PROVIDER_LABELS = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  copilot: 'Copilot',
};

// per provider: { warning: 'below'|'notified', critical: 'below'|'notified' }
const state = new Map();

function levelForEnter(percent, enter, exit, current) {
  if (percent == null) return current;
  if (percent >= enter) return current === 'below' ? 'notified' : current;
  if (percent < exit) return 'below';
  return current;
}

function maybeNotify(providerId, level, percent, label) {
  const providerName = PROVIDER_LABELS[providerId] ?? providerId;
  const levelLabel = level === 'critical' ? 'Critical' : 'Warning';
  const title = `GenAIUsageWidget — ${providerName} ${levelLabel}`;
  const body = `Usage at ${Math.round(percent)}% (${label})`;

  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.show();
}

function checkAndNotify(providerId, snapshot, { enabled, label = 'usage' }) {
  if (!enabled) return;
  if (!snapshot.ok || snapshot.stale) return;
  const percent = snapshot.percent;
  if (percent == null) return;

  let s = state.get(providerId) ?? { warning: 'below', critical: 'below' };

  const prevWarning = s.warning;
  const prevCritical = s.critical;

  s = {
    warning: levelForEnter(percent, WARNING_ENTER, WARNING_EXIT, s.warning),
    critical: levelForEnter(percent, CRITICAL_ENTER, CRITICAL_EXIT, s.critical),
  };
  state.set(providerId, s);

  if (s.warning === 'notified' && prevWarning === 'below') {
    maybeNotify(providerId, 'warning', percent, label);
  }
  if (s.critical === 'notified' && prevCritical === 'below') {
    maybeNotify(providerId, 'critical', percent, label);
  }
}

function resetState() {
  state.clear();
}

module.exports = { checkAndNotify, resetState, WARNING_ENTER, CRITICAL_ENTER };
```

- [ ] **Step 2: ヒステリシスを手動検証**

Run:

```bash
node -e "
const { checkAndNotify, resetState } = require('./src/alerts');
const { Notification } = require('electron');
Notification.isSupported = () => false;
let enabled = true;
const snap = (p) => ({ ok: true, percent: p });
resetState();
checkAndNotify('claude', snap(60), { enabled });
checkAndNotify('claude', snap(72), { enabled });
checkAndNotify('claude', snap(72), { enabled });
checkAndNotify('claude', snap(64), { enabled });
checkAndNotify('claude', snap(72), { enabled });
console.log('hysteresis script completed');
"
```

Expected: エラーなく完了（通知はモックで抑制）

- [ ] **Step 3: Commit**

```bash
git add src/alerts.js
git commit -m "feat: add usage alert state machine with hysteresis"
```

---

### Task 3: main プロセス統合

**Files:**
- Modify: `src/main.js`
- Modify: `src/preload.js`

- [ ] **Step 1: `src/main.js` 先頭に import 追加**

```javascript
const settings = require('./settings');
const alerts = require('./alerts');
```

- [ ] **Step 2: IPC ハンドラを `ipcMain.handle('get-antigravity-usage', ...)` の後に追加**

```javascript
ipcMain.on('report-usage', (_event, payload) => {
  const { provider, percent, ok, stale, label } = payload ?? {};
  if (!provider) return;
  alerts.checkAndNotify(provider, { percent, ok, stale }, {
    enabled: settings.isAlertsEnabled(),
    label: label ?? 'usage',
  });
});
```

- [ ] **Step 3: `createTray()` のコンテキストメニューに Usage Alerts を追加**

`Start at Login` の前に挿入:

```javascript
{
  label: 'Usage Alerts',
  type: 'checkbox',
  checked: settings.isAlertsEnabled(),
  click: (menuItem) => settings.setAlertsEnabled(menuItem.checked),
},
{ type: 'separator' },
```

- [ ] **Step 4: `src/preload.js` に API 追加**

```javascript
reportUsage: (payload) => ipcRenderer.send('report-usage', payload),
```

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat: wire usage alert IPC and tray menu toggle"
```

---

### Task 4: renderer からスナップショット報告

**Files:**
- Modify: `src/renderer.js`

- [ ] **Step 1: ヘルパー関数を `beginCard` の近くに追加**

```javascript
function reportUsage(provider, percent, ok, extra = {}) {
  window.api.reportUsage({ provider, percent, ok, ...extra });
}
```

- [ ] **Step 2: `updateClaudeCard()` — `beginCard` が false のとき**

```javascript
if (!beginCard('claude', result)) {
  reportUsage('claude', null, false);
  return;
}
```

成功パス末尾（`setDetail` の後）:

```javascript
reportUsage('claude', session.percent, true, {
  stale: !!result.stale,
  label: 'session',
});
```

- [ ] **Step 3: `updateCodexCard()` — 同様のパターン**

`notConfigured`/エラー時: `reportUsage('codex', null, false)`  
`primary` なし時: `reportUsage('codex', null, true)`（通知スキップ）  
成功時: `reportUsage('codex', primary.percent, true, { label: 'primary' })`

- [ ] **Step 4: `updateCursorCard()`**

エラー時: `reportUsage('cursor', null, false)`  
成功時: `reportUsage('cursor', percent, true, { label: 'total' })`

- [ ] **Step 5: `updateAntigravityCard()`**

エラー時: `reportUsage('antigravity', null, false)`  
groups 空: `reportUsage('antigravity', null, true)`  
成功時:

```javascript
const maxPercent = Math.max(...groups.map((g) => g.percent ?? 0));
reportUsage('antigravity', maxPercent, true, { label: 'max group' });
```

（`maxPercent` は既存の `setMeter` 用変数を再利用）

- [ ] **Step 6: `updateCopilotCard()`**（[Copilot プロバイダプラン](2026-07-08-github-copilot-provider.md) 実装後）

エラー時: `reportUsage('copilot', null, false)`  
primary/secondary なし: `reportUsage('copilot', null, true)`  
成功時:

```javascript
const headline = primary ?? secondary;
reportUsage('copilot', headline?.percent ?? null, true, {
  label: primary ? 'premium' : 'chat',
});
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer.js
git commit -m "feat: report usage snapshots from renderer for alerts"
```

---

### Task 5: ドキュメント更新

**Files:**
- Modify: `README.md`
- Modify: `README.ja.md`

- [ ] **Step 1: Features セクションに追記（英語）**

```markdown
- **Usage alerts** — native OS notifications when any configured provider
  crosses 70% (warning) or 90% (critical). Toggle from the tray menu
  (on by default). Hysteresis prevents repeat alerts while usage stays high.
```

- [ ] **Step 2: Features セクションに追記（日本語）**

```markdown
- **使用量アラート** — 設定済みプロバイダが 70%（警告）/ 90%（危険）を
  超えたとき OS 通知を表示。トレイメニューから ON/OFF（デフォルト ON）。
  ヒステリシスにより、高使用率が続く間の通知連発を防ぎます。
```

- [ ] **Step 3: Commit**

```bash
git add README.md README.ja.md
git commit -m "docs: document usage alert feature"
```

---

### Task 6: 手動検証

- [ ] **Step 1: アプリ起動**

Run: `npm start`  
Expected: 既存 UI が正常表示、コンソールエラーなし

- [ ] **Step 2: トレイメニュー確認**

右クリック → `Usage Alerts` チェックボックスが表示され、トグル可能

- [ ] **Step 3: 通知動作確認**

実際のプロバイダデータで 70%/90% 到達時に通知が出ること、または開発中は `alerts.js` の閾値を一時的に下げて検証

- [ ] **Step 4: 重複防止確認**

同一閾値帯で 1 分ポーリングを 3 回繰り返しても追加通知が出ないこと

- [ ] **Step 5: OFF 時確認**

`Usage Alerts` を OFF にして通知が出ないこと

---

## Plan Self-Review

| Spec requirement | Task |
|---|---|
| 70%/90% 通知 | Task 2, 4 |
| ヒステリシス | Task 2 |
| トレイ ON/OFF | Task 1, 3 |
| stale/エラー時スキップ | Task 2, 4 |
| README 更新 | Task 5 |
| Win/Linux | Electron Notification（既存プラットフォーム） |

プレースホルダー: なし

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-08-usage-alerts.md`. Two execution options:

**1. Subagent-Driven (recommended)** — タスクごとに新しいサブエージェントを起動し、タスク間でレビュー

**2. Inline Execution** — このセッションで `executing-plans` スキルに従い一括実装

Which approach?
