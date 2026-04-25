# scripts

## L Singer Tower Battle Collider QA
- `convert_svg_collider.py`
  - SVG輪郭をCollider JSONへ変換。
  - 幾何QA（自己交差 / 最小辺長 / 反射率 / 頂点数 / 連続鋭角）に失敗した場合は出力せず終了。
  - 細かい輪郭向けのデフォルト閾値: `minEdgeWorld=1.0`, `maxReflexRatio=0.55`, `maxVertices=96`。
- `validate_collider_alignment.py`
  - PNGアルファ輪郭とColliderの重なりを検証（IoU / 未カバー率）。
- `check_character_colliders.py`
  - `content/games/l-singer-tower-battle/config.json` の全キャラを一括QA検証。
  - 1件でも失敗したら終了コード1。
