# L Singer Tower Battle Character Collider QA Flow

## Asset set (per character)
- PNG: `/public/assets/games/l-singer-tower-battle/characters/<id>.png`
- SVG source: `/content/games/l-singer-tower-battle/colliders-src/<id>.svg`
- Collider JSON output: `/content/games/l-singer-tower-battle/colliders/<id>.collider.json`

PNG と SVG は必ず同一キャンバスサイズ・同一原点で作成する。

## Required QA Gate (no exceptions)
1. Geometry QA (conversion-time, strict):
```bash
python3 scripts/convert_svg_collider.py \
  content/games/l-singer-tower-battle/colliders-src/<id>.svg \
  content/games/l-singer-tower-battle/colliders/<id>.collider.json \
  --world-scale 0.24 \
  --qa-min-edge-world 1.0 \
  --qa-max-reflex-ratio 0.55 \
  --qa-max-vertices 96 \
  --qa-max-consecutive-sharp 6
```

2. PNG/Collider alignment QA:
```bash
python3 scripts/validate_collider_alignment.py \
  public/assets/games/l-singer-tower-battle/characters/<id>.png \
  content/games/l-singer-tower-battle/colliders/<id>.collider.json \
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

## Runtime stability tuning (detail-friendly)
- `content/games/l-singer-tower-battle/config.json` の `physics.substeps` を `3` 以上に設定する。
- `physics.iterations.position / velocity / constraint` を高めに設定し、細かい輪郭でも接触解決の破綻を抑える。
- `physics.colliderBuild` で `removeCollinear / minimumArea / removeDuplicatePoints` を設定し、分解時の微小パーツ生成を抑える。
