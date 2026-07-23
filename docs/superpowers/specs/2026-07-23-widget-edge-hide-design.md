# Widget Edge Hide (PC Manager style)

## Goal

デスクトップウィジェットを Microsoft PC Manager のフローティングツールバーと同様に、画面端へ吸着させて隠せるようにする。

## Behavior

1. ウィジェットを**上端**近くまでドラッグして離すか、ヘッダーの ▲ を押すと、同じモニタ上辺の細い peek タブに折りたたむ。
2. peek を**クリック**すると明示的に開いたままにする（再度 ▲ で隠すまで維持）。ホバーでは展開しない。
3. 上端から離してドラッグ、またはトレイの「Restore Widget Position」でドック解除。
4. トレイの「Hide Desktop Widget」は従来どおり完全非表示（別操作）。
5. ドック状態は `settings.json` の `widgetEdgeHide: "top"` に永続化し、再起動後も折りたたみ状態で復元する。

## Settings

```json
{
  "widgetEdgeHide": null | "top"
}
```

（古い `left` / `right` 値は読み込み時に `top` へ移行する。）

`widgetBounds` は展開時（端にぴったり接した位置）を保存する。折りたたみ座標は保存しない。

## Out of scope

- 左右端へのドック（上端のみ）
- 完全非表示のトレイ操作の置き換え
- ホバーによる一時プレビュー（UI/UX ポリッシュで廃止）
