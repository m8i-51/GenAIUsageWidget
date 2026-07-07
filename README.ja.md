# GenAIUsageWidget

[English](README.md) | 日本語

Windows / Linux 向けのトレイアプリ + デスクトップウィジェットです
(macOS専用の [CodexBar](https://github.com/steipete/CodexBar) にインスパイアされています)。
ローカルでサインイン済みのAIコーディングツールの使用量・レート制限を表示します:

- **Claude** — セッション(5時間)・週間・モデル別週間の使用量
- **Codex** — プライマリ(および存在すれば週間)レート制限枠の使用量
- **Cursor** — プラン使用量(Total / Auto / API の内訳)と請求サイクルのカウントダウン
- **Antigravity (Gemini Code Assist)** — モデルグループごとの週間クォータ

各プロバイダのローカルの認証情報をそのまま読むので、改めてログインする必要は
ありません。使用量APIはおよそ1分ごとにポーリングします。

## 特徴

- **Glassmorphism UI** — すりガラスのカードにプロバイダごとのグロー。ライト/
  ダークモード対応、使用量が上がるとメーターが警告色・危険色に変化します。
- **2つの表示方法:**
  - **トレイアイコン** — クリックでトレイ近くにポップアップ表示。他をクリックで閉じます。
  - **デスクトップウィジェット** — 画面右上に常駐する最前面のドラッグ可能なカード。
    トレイアイコンの右クリックメニューから表示/非表示を切り替えられます。
- **カードの展開** — カードをクリックすると詳細メーターを表示(例: Claudeの
  Session / Weekly / モデル別Weekly、Cursorの Total / Auto / API)。追加情報が
  ないカードはそもそも展開しません。
- **ドラッグ&ドロップ並び替え** — カードを掴んで上下にドラッグすると、他の
  カードがスッと滑って場所を空けます。並び順は保存され、再起動後も維持されます。
- **未セットアップのプロバイダは非表示** — 使っていないツールのエラーは出ません。
  後からサインインすれば、1分以内にカードが自動で現れます。
- **レート制限にやさしい** — Claudeのレスポンスはキャッシュしてポップアップと
  ウィジェットで共有。429を受けたら長めのバックオフ(`Retry-After` に準拠)を行い、
  APIが使えない間は最後に取得できたデータを取得時刻付きで表示します
  (アプリを再起動しても保持されます)。
- ウィンドウは中身の高さに自動でフィットするので、透明なウィジェットが背後への
  クリックを邪魔しません。

## セットアップ

```
npm install
npm start
```

## 各プロバイダの認証情報の取得元

| プロバイダ | 取得元 | 備考 |
|---|---|---|
| Claude | `~/.claude/.credentials.json` | Claude Code CLI のログイン時に書き込まれます |
| Codex | `~/.codex/auth.json` | `codex` CLI が書き込みます(`npm i -g @openai/codex` → `codex login`) |
| Cursor | Cursorアプリの `state.vscdb`(SQLite、`sql.js` 経由) | Cursorデスクトップアプリのインストールとサインインが必要です |
| Antigravity | Windows資格情報マネージャー、ターゲット `gemini:antigravity` | `agy` CLI(`winget install Google.AntigravityCLI`)で一度サインインしている必要があります。**Windows専用** — 小さなPythonヘルパースクリプト(`src/providers/win-cred-read.py`)で資格情報を読むため、Pythonが `PATH` にある必要があります。 |

プロバイダが未セットアップの場合、そのカードは非表示になります。セットアップ済み
なのにAPI呼び出しが失敗した場合はエラー表示になります(Claudeの場合は、最後に
取得できたデータを取得時刻付きで表示します)。

## プロジェクト構成

```
src/
  main.js              Electronメインプロセス: トレイ、ポップアップ、ウィジェット、
                       IPC、Claudeレスポンスキャッシュと429バックオフ
  preload.js           get-*-usage のIPC呼び出しとウィンドウリサイズを公開
  index.html / renderer.js   ポップアップとウィジェットで共有するUI
  providers/           プロバイダごとに1モジュール(fetchXUsage() をエクスポート)。
                       not-configured.js は「未セットアップ」エラーの目印
assets/icon.png        トレイアイコン
```

## 既知の制限

- Antigravity対応は今のところWindowsのみです(Cursor/Claude/Codexはクロスプラットフォーム)。
- トークンのリフレッシュ処理は未実装です — プロバイダのトークンが期限切れになると、
  各プロバイダのCLI/アプリで再認証するまでカードはエラー表示になります。
