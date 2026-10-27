# Stream Deck Plugin

## Goal

GenAIUsageWidget が表示している使用量を Elgato Stream Deck のキーにも出す。1 キー = 1 つの制限（例: Claude の 5 時間枠）。ウィジェットが起動していなくても単体で動き、両方起動しているときは API を二重に叩かない。GitHub Releases と Elgato Marketplace で配布する。

## Architecture

```
GenAIUsageWidget/
├─ src/providers/*.js   取得コード（ウィジェットとプラグインで共有）
├─ src/usage-cache.js   保存先を setDataDir() で差し替え可能にする（既定は Electron の userData）
├─ src/local-api.js     新規: 127.0.0.1 の読み取り専用 HTTP API
└─ streamdeck/          新規: プラグイン（@elgato/streamdeck + rollup）
```

### Widget local API

- `GET http://127.0.0.1:47821/v1/usage?providers=claude,codex`
- 応答: `{ app: "GenAIUsageWidget", version, at, providers: { <id>: <getUsage() と同じ payload> } }`
- `providers` 省略時は全プロバイダ。未知の id は無視。
- ウィジェットのカードと同じ `getUsage()`（キャッシュ・429 バックオフ・last-good 込み）を通すので、プラグインからの問い合わせで API 呼び出しは増えない。通知（alerts）は発火させない。
- 認証トークンは含めない（payload にもともと入っていない）。
- `127.0.0.1` にのみ bind。`Host` ヘッダーが `127.0.0.1:47821` / `localhost:47821` 以外は 403（DNS rebinding 対策）。CORS ヘッダーは付けない。GET 以外は 405、他のパスは 404。
- ポートが使用中なら警告ログだけ出してウィジェットは通常どおり動く。

### Plugin data flow

1. 表示中のキーが必要とするプロバイダだけを 30 秒ごとに取得する。
2. まずウィジェットの local API に問い合わせる（タイムアウト 800ms）。`app === "GenAIUsageWidget"` を確認できたらその値を使う。
3. 応答がなければ共有の取得コードで直接取得する。`usage-cache` をそのまま使うので Claude の 150 秒 TTL、429 バックオフ、last-good（`%APPDATA%\GenAIUsageWidget\streamdeck`）もウィジェットと同じルール。
4. z.ai は API キーを Electron の safeStorage で保存しているため、単体では取得できない。ウィジェット経由のときだけ表示し、単体では「Needs widget」を出す。

既知の制限: 単体で動いている途中でウィジェットを起動すると、その瞬間だけ Claude を 2 回叩くことがある（1 回限りなので 429 にはなりにくい）。

## Keys

アクションは 2 種類（Marketplace のガイドラインはアクション 2〜30 個を求める）。

- **Usage Limit**: Property Inspector で **プロバイダ** と **制限** を選ぶ。制限の選択肢は最後に取得した payload から作る（モデル名やグループ名が変わっても追従する）。

| Provider | Limits |
|---|---|
| Claude | 5h / Week / モデル別週制限（`weekScoped.name`） |
| Codex | 5h / Week |
| Cursor | Week（統合プール）または Total / Auto / API / Grok Bot、API spend（上限ありのとき） |
| Antigravity | グループ / バケットごと |
| Copilot | Premium / Chat |
| Gemini | Pro / Flash |
| Windsurf | Day / Week（credits プランは Prompts / Flow） |
| Kiro | Credits / Bonus |
| z.ai | 5h / Week / MCP（ウィジェット経由のみ） |

ラベルは「Claude · 5h」のように自動生成し、Property Inspector で上書きできる。

- **Closest Limit**: 対象プロバイダ（Property Inspector のチェックボックス、既定は全部）の中で使用率がいちばん高い制限を表示する（トレイアイコンと同じ考え方）。ラベルは選ばれた制限の「Codex · 5h」など。どれもサインインしていなければ「No sign-ins」。押す・長押しの動作は Usage Limit と同じ。

### Key face（水位）

- キー全体が下から使用率ぶん満ちる。色はトレイ／カードと同じしきい値: 45% 未満 ok、45% 以上 warning、70% 以上 critical。
- 上部にラベル、中央に使用率。
- 押すと「リセットまでの時間」（`42m` / `2h14m` / `3d 4h`）に切り替わり、もう一度押すか 10 秒で使用率に戻る。
- 長押し（0.6 秒以上）で即時再取得（`requestRefresh` の最小間隔は守る）。

| 状態 | 表示 |
|---|---|
| 通常 | 水位 + 数字 |
| stale（last-good を表示中） | 水位と数字を薄く、右上に時計マーク |
| 未ログイン（notConfigured） | グレー、「Sign in」 |
| 認証切れ（authExpired） | グレー、「Sign in again」 |
| z.ai 単体 | グレー、「Needs widget」 |
| Closest Limit で対象がどれもサインインしていない | グレー、「No sign-ins」 |
| 取得失敗・データなし | グレー、「—」 |
| 初回取得中 | グレー、「…」 |

## Platform / packaging

- Windows のみ（macOS は Claude が Keychain、Antigravity が別保存先で、今の取得コードでは読めない）。
- UUID: `com.github.m8i-51.genaiusage`。Node.js 20（Stream Deck 同梱）。SDKVersion 3、Stream Deck 6.9 以上。`@elgato/streamdeck` は 2 系（Marketplace の DRM 要件）。配布物の `manifest.json` は実行時に読まない。
- rollup で `src/providers` と `usage-cache` を `bin/plugin.js` にまとめる。`sql.js` は external にして `bin/node_modules/sql.js` にコピー、`win-cred-read.py` は `bin/` にコピー。
- UI 文言は英語を基本に、`ja.json` で日本語化。キーの文言は `streamDeck.info.application.language` で切り替える。
- `release.yml` に `streamdeck pack` のジョブを追加し、`.streamDeckPlugin` を同じ Release に添付。Marketplace への申請は手作業（素材は動作確認後に用意）。

## Testing

- `node --test`（ルート）: local API ハンドラ（Host チェック、providers フィルタ、405/404）、`usage-cache` の保存先差し替え。
- `node --test`（streamdeck/）: payload から制限を取り出す処理（`demo-usage.js` の全プロバイダ）、キー画像 SVG（しきい値の色、水位の高さ、各状態の文言）、リセット時間の書式、usage source のウィジェット → 単体フォールバック。
- CI に両方のテストと `streamdeck validate` を追加。
- 実機: ウィジェット起動中 / 停止中の両方でキーが更新されることを確認。

## Privacy (README)

プラグインはこの PC にある各 CLI のログイン情報を読み、各社の API にだけ送信する。ウィジェットの local API は 127.0.0.1 からの読み取り専用で、トークンは返さない。
