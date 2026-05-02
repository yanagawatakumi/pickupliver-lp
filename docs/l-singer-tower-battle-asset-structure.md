# Lシンガータワーバトル: アセット構造ガイド

将来の `vol4`, `vol5` 追加を前提に、キャラアセットは以下構造で管理する。

## ディレクトリ構造

- `public/assets/games/l-singer-tower-battle/characters/`
  - `mc/` : MC系キャラPNG
  - `vol1/`, `vol2/`, `vol3/`, `vol4/`, ... : 各volゲストPNG
- `content/games/l-singer-tower-battle/colliders/`
  - `mc/`, `vol1/`, `vol2/`, `vol3/`, `vol4/`, ... : 変換済みCollider JSON
- `content/games/l-singer-tower-battle/colliders-src/`
  - `mc/`, `vol1/`, `vol2/`, `vol3/`, `vol4/`, ... : 元SVG

## 追加手順

1. PNGを `characters/<vol or mc>/` に配置
2. SVGを `colliders-src/<vol or mc>/` に配置
3. 変換して `colliders/<vol or mc>/` に JSON 出力
4. `content/games/l-singer-tower-battle/config.json` の `shapes` にキャラを追加
5. `config.json` の `modes[].shapeIds` にモード別でIDを追加

## 命名規約

- `shape.id` とファイル名のベースを一致させる
- 既存IDの変更はランキング表示やモード定義に影響するため禁止

