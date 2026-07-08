# GitHub Copilot プロバイダ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Copilot CLI のローカル認証から Premium / Chat 枠の使用率を取得し、既存カード UI に Copilot タイルとして表示する。

**Architecture:** 新設 `src/providers/copilot.js` が env → keychain → `~/.copilot/config.json` の順で GitHub トークンを解決し、`GET /copilot_internal/user` を呼ぶ。返却形状は Codex と同型（primary/secondary）。renderer / main / index.html に既存プロバイダと同パターンで配線する。

**Tech Stack:** Electron 32, Node.js fetch, 既存 `win-cred-read.py`, Linux `secret-tool`（任意）

**Spec:** [2026-07-08-github-copilot-provider-design.md](../specs/2026-07-08-github-copilot-provider-design.md)

**依存:** テーマ C（使用量アラート）と併用する場合は本プラン完了後にアラートプランの Copilot 統合ステップを実行。

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/providers/copilot.js` | Create | トークン解決 + API 呼び出し + 正規化 |
| `src/main.js` | Modify | `get-copilot-usage` IPC |
| `src/preload.js` | Modify | `getCopilotUsage` 公開 |
| `src/renderer.js` | Modify | `updateCopilotCard()` |
| `src/index.html` | Modify | Copilot タイル + CSS 変数 |
| `README.md` | Modify | プロバイダ表追記 |
| `README.ja.md` | Modify | プロバイダ表追記（日本語） |

---

### Task 1: Copilot プロバイダモジュール

**Files:**
- Create: `src/providers/copilot.js`

- [ ] **Step 1: `src/providers/copilot.js` を作成**

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { notConfigured } = require('./not-configured');

const USAGE_URL = 'https://api.github.com/copilot_internal/user';
const COPILOT_HOME = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
const CONFIG_PATH = path.join(COPILOT_HOME, 'config.json');
const KEYCHAIN_SERVICE = 'copilot-cli';

function tokenFromEnv() {
  return process.env.COPILOT_GITHUB_TOKEN
    || process.env.GH_TOKEN
    || process.env.GITHUB_TOKEN
    || null;
}

function parseTokenBlob(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed;
    return parsed.token
      || parsed.access_token
      || parsed.githubToken
      || parsed.oauthToken
      || null;
  } catch {
    return trimmed;
  }
}

function readTokenFromWindowsKeychain() {
  const scriptPath = path.join(__dirname, 'win-cred-read.py');
  try {
    const output = execFileSync('python', [scriptPath, KEYCHAIN_SERVICE], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseTokenBlob(output);
  } catch {
    return null;
  }
}

function readTokenFromLinuxKeyring() {
  try {
    const output = execFileSync('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseTokenBlob(output);
  } catch {
    return null;
  }
}

function readTokenFromConfigFile() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const config = JSON.parse(raw);
  const candidates = [
    config?.githubToken,
    config?.auth?.githubToken,
    config?.auth?.token,
    config?.oauth?.access_token,
    config?.token,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function readGitHubToken() {
  const envToken = tokenFromEnv();
  if (envToken) return envToken;

  let keychainToken = null;
  if (process.platform === 'win32') {
    keychainToken = readTokenFromWindowsKeychain();
  } else if (process.platform === 'linux') {
    keychainToken = readTokenFromLinuxKeyring();
  }
  if (keychainToken) return keychainToken;

  const fileToken = readTokenFromConfigFile();
  if (fileToken) return fileToken;

  if (process.platform === 'win32') {
    throw notConfigured('GitHub Copilot CLI is not signed in (needs copilot login and Python for keychain)');
  }
  throw notConfigured('GitHub Copilot CLI is not signed in on this machine');
}

function parseResetDate(value) {
  if (!value) return null;
  const iso = new Date(value);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`).toISOString();
  return null;
}

function makeWindow(snapshot, resetsAt) {
  if (!snapshot || snapshot.isPlaceholder) return null;
  if (snapshot.percentRemaining == null) return null;
  return {
    percent: Math.max(0, Math.min(100, 100 - snapshot.percentRemaining)),
    resetsAt: snapshot.unlimited ? null : resetsAt,
  };
}

async function fetchCopilotUsage() {
  const token = readGitHubToken();

  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      'Editor-Version': 'vscode/1.96.2',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'X-Github-Api-Version': '2025-04-01',
    },
  });

  if (!res.ok) {
    throw new Error(`Copilot usage request failed: ${res.status}`);
  }

  const data = await res.json();
  const resetsAt = parseResetDate(data.quotaResetDate);
  const premium = makeWindow(data.quotaSnapshots?.premiumInteractions, resetsAt);
  const chat = makeWindow(data.quotaSnapshots?.chat, resetsAt);

  return {
    primary: premium,
    secondary: chat,
    plan: data.copilotPlan ?? null,
  };
}

module.exports = { fetchCopilotUsage };
```

- [ ] **Step 2: 構文チェック**

Run: `node --check src/providers/copilot.js`  
Expected: 終了コード 0、出力なし

- [ ] **Step 3: Commit**

```bash
git add src/providers/copilot.js
git commit -m "feat: add GitHub Copilot usage provider module"
```

---

### Task 2: main / preload 配線

**Files:**
- Modify: `src/main.js`
- Modify: `src/preload.js`

- [ ] **Step 1: `src/main.js` に import 追加**

```javascript
const { fetchCopilotUsage } = require('./providers/copilot');
```

- [ ] **Step 2: IPC ハンドラ追加（`get-antigravity-usage` の後）**

```javascript
ipcMain.handle('get-copilot-usage', async () => {
  try {
    const usage = await fetchCopilotUsage();
    return { ok: true, usage };
  } catch (err) {
    return { ok: false, error: err.message, notConfigured: !!err.notConfigured };
  }
});
```

- [ ] **Step 3: `src/preload.js` に API 追加**

```javascript
getCopilotUsage: () => ipcRenderer.invoke('get-copilot-usage'),
```

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat: wire Copilot usage IPC handler"
```

---

### Task 3: UI — index.html

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: CSS 変数に Copilot 色を追加（`:root` と dark media）**

```css
--id-copilot: #1f6feb;
```

dark mode:

```css
--id-copilot: #388bfd;
```

- [ ] **Step 2: dot glow ルール追加**

```css
#copilot-provider .dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--id-copilot) 20%, transparent); }
```

- [ ] **Step 3: Codex タイルの直後に Copilot タイルを挿入**

```html
<div class="tile" id="copilot-provider">
  <div class="tile-header">
    <span class="tile-identity">
      <span class="dot" style="background: var(--id-copilot)"></span>
      <span class="tile-label">Copilot</span>
    </span>
    <span class="tile-value" id="copilot-value">–</span>
    <span class="chevron"></span>
  </div>
  <div class="meter"><span class="meter-fill" id="copilot-bar" style="width: 0%"></span></div>
  <div class="tile-sub" id="copilot-reset">Loading…</div>
  <div class="tile-detail" id="copilot-detail"></div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat: add Copilot provider card to UI"
```

---

### Task 4: renderer カード更新

**Files:**
- Modify: `src/renderer.js`

- [ ] **Step 1: `updateCopilotCard()` を追加（Codex と同型）**

```javascript
async function updateCopilotCard() {
  const result = await window.api.getCopilotUsage();
  if (!beginCard('copilot', result)) return;
  const resetEl = document.getElementById('copilot-reset');

  const { primary, secondary, plan } = result.usage;
  if (!primary && !secondary) {
    resetEl.textContent = plan ? `${plan} — No quota data` : 'No quota data';
    setDetail('copilot', []);
    return;
  }

  const headline = primary ?? secondary;
  setMeter('copilot', headline.percent);
  const planPrefix = plan ? `${plan} · ` : '';
  resetEl.textContent = primary
    ? `${planPrefix}resets in ${formatCountdown(primary.resetsAt)}`
    : `${planPrefix}Chat ${secondary.percent}%`;

  const rows = [];
  if (primary) {
    rows.push({
      label: 'Premium',
      percent: primary.percent,
      sub: `resets in ${formatCountdown(primary.resetsAt)}`,
    });
  }
  if (secondary) {
    rows.push({
      label: 'Chat',
      percent: secondary.percent,
      sub: `resets in ${formatCountdown(secondary.resetsAt)}`,
    });
  }
  setDetail('copilot', rows.length > 1 ? rows : []);
}
```

- [ ] **Step 2: `updateAll()` の `Promise.all` に追加**

```javascript
updateCopilotCard(),
```

（Codex の後、Antigravity の前）

- [ ] **Step 3: Commit**

```bash
git add src/renderer.js
git commit -m "feat: render Copilot usage card"
```

---

### Task 5: README 更新

**Files:**
- Modify: `README.md`
- Modify: `README.ja.md`

- [ ] **Step 1: プロバイダ一覧に Copilot を追加**

英語 intro リスト:

```markdown
- **Copilot** — Premium and Chat quota usage (via GitHub Copilot CLI session)
```

日本語:

```markdown
- **Copilot** — Premium / Chat 枠の使用量（GitHub Copilot CLI のセッション経由）
```

- [ ] **Step 2: 認証情報テーブルに行追加**

| Copilot | `copilot-cli` keychain / `~/.copilot/config.json` / `COPILOT_GITHUB_TOKEN`・`GH_TOKEN`・`GITHUB_TOKEN` | Run `copilot login`. On Windows, reading the keychain uses Python via `win-cred-read.py`. |

- [ ] **Step 3: Commit**

```bash
git add README.md README.ja.md
git commit -m "docs: document GitHub Copilot provider"
```

---

### Task 6: 手動検証

- [ ] **Step 1: 未設定環境**

`npm start` — Copilot 未ログイン時、カードが非表示

- [ ] **Step 2: 設定済み環境**

`copilot login` 後、Premium/Chat メーターが表示される

- [ ] **Step 3: 既存プロバイダ回帰**

Claude/Codex/Cursor/Antigravity の表示・DnD 並び替えが壊れていない

- [ ] **Step 4: env トークン**

`GH_TOKEN=... npm start` で keychain なしでも動作（任意）

---

## Plan Self-Review

| Spec requirement | Task |
|---|---|
| env → keychain → config トークン解決 | Task 1 |
| copilot_internal API | Task 1 |
| Codex 同型 UI | Task 3, 4 |
| notConfigured 非表示 | Task 1, 4 |
| README | Task 5 |

---

## Execution Handoff

Plan complete. テーマ C と併用する場合:

1. 本プラン（Copilot プロバイダ）を先に実装
2. [使用量アラートプラン](2026-07-08-usage-alerts.md) の Task 4 に Copilot `reportUsage` ステップを追加して実装

**1. Subagent-Driven (recommended)** — タスクごとにサブエージェント  
**2. Inline Execution** — 一括実装

Which approach?
