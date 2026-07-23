# UI/UX ポリッシュ — 実装計画

**日付:** 2026-07-23  
**仕様:** [2026-07-23-ui-ux-polish-design.md](../specs/2026-07-23-ui-ux-polish-design.md)

## 手順

1. `src/index.html` — `#cards-view` gap、Compact を cards 限定、peek title
2. `src/renderer.js` / `src/preload.js` / `src/main.js` — ホバー一時展開除去、メニュー名、トレイ click 分岐
3. `scripts/verify-edge-hide.js` — ホバー検証を更新
4. README 更新
5. `npm run verify:edge-hide` と linux `--dir` パッケージ確認
