# UI/UX ポリッシュ — 設計仕様

**日付:** 2026-07-23  
**テーマ:** カード余白・端 Hide 操作・トレイ二重表示・Compact 副作用・メニュー文言  
**ステータス:** 承認済み（ブレインストーミング経由）  
**アプローチ:** 案 A — 既存ファイルへの局所パッチ

---

## 1. ゴールとスコープ

### ゴール

ウィジェットの窮屈さ・端 Hide の操作の迷い・トレイと Widget の二重表示・Compact の副作用・メニュー文言の分かりにくさを、ひとまとまりの UI/UX ポリッシュとして解消する。

### 含む

1. カード間ギャップ拡大（通常 15px、Compact 9px）
2. 端 Hide: ホバー一時展開を廃止。peek クリックで開きっぱ、▲ で閉じる
3. Compact mode は `#cards-view` だけに適用（Settings は常に通常見た目）
4. Desktop Widget 表示中のトレイ左クリックは Popup を出さず Widget を前面へ
5. トレイメニュー `Undock Widget` → `Restore Widget Position`

### 含まない

- 使用量アラート / Copilot など別機能
- 端 Hide の状態機械の全面書き換え
- トレイ Popup の完全廃止
- メニューの日本語化全体

---

## 2. 操作の振る舞い

### 端 Hide（ホバー廃止）

| 操作 | 結果 |
|---|---|
| 上端ドラッグ／▲ | 細い peek に折りたたむ |
| peek を**クリック** | 展開してピン留め（開きっぱ） |
| peek にホバー | **何もしない**（展開しない） |
| ピン留め中に ▲ | 再び peek に折りたたむ |
| トレイ `Restore Widget Position` | ドック解除し、通常ウィジェット位置へ |

実装: `renderer` の `mouseenter`/`mouseleave` → `setWidgetEdgeHover` を削除。main の `widget-edge-hide-hover` ハンドラとホバー専用の一時展開／自動折りたたみパスを除去。peek の title から “hover to preview” を消す。

### トレイ左クリック

| Widget 状態 | トレイ左クリック |
|---|---|
| 表示中（端 Hide の peek 含む） | Popup **出さない**。Widget を `show` + `focus`（peek 中ならピン留め展開） |
| 非表示 | 従来どおり Popup をトグル |

右クリックメニューは現状どおり（ラベル変更のみ）。

---

## 3. 見た目（余白・Compact）

### カード間ギャップ

`#cards-view` を縦 flex + `gap` にする（現状タイル同士に明示的 gap がない）。

| モード | `#cards-view` のカード間 gap |
|---|---|
| 通常 | **15px** |
| Compact | **9px** |

### Compact の適用範囲

- `body.compact-mode` のスタイルはカード一覧向けだけ（`body.compact-mode #cards-view ...`）
- `body.compact-mode .app { gap; padding }` のような全体ルールは削除
- Settings パネルは Compact ON/OFF で見た目が変わらない
- ヘッダーの更新時刻などカード外も Compact で縮めない

---

## 4. 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/index.html` | `#cards-view` に gap。Compact CSS を cards 限定。peek title 更新 |
| `src/renderer.js` | ホバー IPC 送信削除。tooltip 文言更新 |
| `src/preload.js` | `setWidgetEdgeHover` 削除 |
| `src/main.js` | ホバーパス除去。トレイ click 分岐。メニュー名変更 |
| `scripts/verify-edge-hide.js` | ホバー検証を削除／クリック前提に更新 |
| `docs/superpowers/specs/2026-07-23-widget-edge-hide-design.md` | hover 削除、メニュー名更新 |
| `README.md` / `README.ja.md` | 新挙動を反映 |

### トレイ click の流れ

```
tray click
  → widget visible?
       yes → widget.show(); widget.focus();
             if docked && collapsed → expandEdgeHide({ pinned: true })
       no  → togglePopup(bounds)
```

### 端 Hide の状態（簡略後）

- `collapsed`（peek）↔ `pinned open`（クリックで開く／▲ で閉じる）
- ホバーによる一時 `expanded && !pinned` は持たない

---

## 5. 検証方針

1. 通常／Compact でカード間が空く。Settings は Compact で変わらない
2. peek ホバーで開かない。クリックで開きっぱ。▲ で閉じる。`Restore Widget Position` でドック解除
3. Widget 表示中はトレイ左クリックで Popup が増えない
4. カード展開・並べ替え・プロバイダ非表示・ログイン時起動は壊さない
5. `npm run verify:edge-hide` と `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist -- --linux --dir` が通る
