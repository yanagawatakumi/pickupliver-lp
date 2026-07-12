# L Singer Tower Battle Character Collider QA Flow

## Asset set (per character)
- PNG: `/public/assets/games/l-singer-tower-battle/characters/<group>/<id>.png`
- SVG source: `/content/games/l-singer-tower-battle/colliders-src/<group>/<id>.svg`
- Collider JSON output: `/content/games/l-singer-tower-battle/colliders/<group>/<id>.collider.json`

`<group>` は `vol1`, `vol2`, `vol3`, `vol4`, `mc` などの出演回・所属単位とする。今後の回も同じ規則で追加する。

PNG と SVG は必ず同一キャンバスサイズ・同一原点で作成する。

## Required QA Gate (no exceptions)
1. Geometry QA (conversion-time, strict):
```bash
python3 scripts/convert_svg_collider.py \
  content/games/l-singer-tower-battle/colliders-src/<group>/<id>.svg \
  content/games/l-singer-tower-battle/colliders/<group>/<id>.collider.json \
  --world-scale <config.jsonのscale> \
  --qa-min-edge-world 1.0 \
  --qa-max-reflex-ratio 0.55 \
  --qa-max-vertices 96 \
  --qa-max-consecutive-sharp 6
```

2. PNG/Collider alignment QA:
```bash
python3 scripts/validate_collider_alignment.py \
  public/assets/games/l-singer-tower-battle/characters/<group>/<id>.png \
  content/games/l-singer-tower-battle/colliders/<group>/<id>.collider.json \
  --min-iou 0.87 \
  --max-uncovered-ratio 0.07
```

どちらか1つでも失敗したら `config.json` に追加しない。

3. Configに登録済みキャラの全件QAチェック:
```bash
python3 scripts/check_character_colliders.py
```

`check_character_colliders.py` が1件でも失敗した場合、そのキャラは運用対象外。
ランタイムでもQA不合格キャラは自動でロード対象から除外される。

## Config shape fields (required)
- `id`
- `label`
- `kind: "character"`
- `imagePath`
- `colliderPath`
- `sourceWidth`
- `sourceHeight`
- `scale`
- `weight`

任意の自動フォールバック用項目は使わない。

## Mode registration
- `shapes` は全キャラ共通マスタとして管理する。
- `modes[].shapeIds` で各モードの抽選対象を指定する。
- `modes[].playable` が `true` のモードだけをゲーム開始画面に表示する。
- `modes[].archived` が `true` のモードは過去ランキング内だけに表示する。
- キャラ構成が変わる場合は既存モードIDを使い回さず、新しいモードIDを作成してランキングを分離する。
- 新しいモードIDを追加した場合は、ランキングAPIとプレイ記録APIの許可モードにも同じIDを追加する。

## Runtime stability tuning (detail-friendly)
- `content/games/l-singer-tower-battle/config.json` の `physics.substeps` を `3` 以上に設定する。
- `physics.iterations.position / velocity / constraint` を高めに設定し、細かい輪郭でも接触解決の破綻を抑える。
- `physics.colliderBuild` で `removeCollinear / minimumArea / removeDuplicatePoints` を設定し、分解時の微小パーツ生成を抑える。
