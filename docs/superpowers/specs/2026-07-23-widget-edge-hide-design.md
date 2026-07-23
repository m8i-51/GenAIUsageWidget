# Widget Edge Hide (PC Manager style)

## Goal

デスクトップウィジェットを Microsoft PC Manager のフローティングツールバーと同様に、画面端へ吸着させて隠せるようにする。

## Behavior

1. ウィジェットを**上端**近くまでドラッグして離すか、ヘッダーの ▲ を押すと、同じモニタ上辺の細い peek タブに折りたたむ。
2. peek に**ホバー**すると一時的に展開する。カーソルが離れると再び折りたたむ（ピン留めしない）。
3. peek を**クリック**すると明示的に開いたままにする（再度 ▲ で隠すまで維持）。
4. 上端から離してドラッグ、またはトレイの「Undock Widget」でドック解除。
5. トレイの「Hide Desktop Widget」は従来どおり完全非表示（別操作）。
6. ドック状態は `settings.json` の `widgetEdgeHide: "top"` に永続化し、再起動後も折りたたみ状態で復元する。

## Settings

```json
{
  "widgetEdgeHide": null | "left" | "right"
}
```

`widgetBounds` は展開時（端にぴったり接した位置）を保存する。折りたたみ座標は保存しない。

## Out of scope

- 上下端へのドック（縦長カードのため左右優先）
- 完全非表示のトレイ操作の置き換え
