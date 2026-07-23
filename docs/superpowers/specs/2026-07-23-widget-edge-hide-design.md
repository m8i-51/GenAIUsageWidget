# Widget Edge Hide (PC Manager style)

## Goal

デスクトップウィジェットを Microsoft PC Manager のフローティングツールバーと同様に、画面端へ吸着させて隠せるようにする。

## Behavior

1. ウィジェットを**左 / 右 / 上端**近くまでドラッグして離すと、同じモニタのその辺に細い peek タブへ折りたたむ。
2. ヘッダーの Hide ボタンは、現在位置から**最も近い辺**へ折りたたむ（距離が同じなら top 優先）。
3. peek を**クリック**すると明示的に開いたままにする（再度 Hide ボタンで隠すまで維持）。ホバーでは展開しない。
4. 端から離してドラッグ、またはトレイの「Restore Widget Position」でドック解除。
5. トレイの「Hide Desktop Widget」は従来どおり完全非表示（別操作）。トレイの「Hide to Edge」は Hide ボタンと同じく最寄り辺へ折りたたむ。
6. ドック状態は `settings.json` の `widgetEdgeHide` に永続化し、再起動後も折りたたみ状態で復元する。

## Peek 形状

| 辺 | peek |
|---|---|
| top | 横長ストリップ（幅 = ウィジェット幅、高さ = 28px） |
| left / right | 縦長ストリップ（幅 = 28px、高さ = 展開時高さ） |

## Settings

```json
{
  "widgetEdgeHide": null | "left" | "right" | "top"
}
```

`widgetBounds` は展開時（端にぴったり接した位置）を保存する。折りたたみ座標は保存しない。

## Out of scope

- 下端へのドック
- 完全非表示のトレイ操作の置き換え
- ホバーによる一時プレビュー（UI/UX ポリッシュで廃止）
