# VOL.3 要件定義メモ

## 1. まず決める項目（必須）
- 開催日: `YYYY-MM-DD`
- 開始時刻: `HH:MM`（JST）
- 終了予定時刻: `HH:MM`（JST）
- 配信枠URL（primaryUrl）
- MC（氏名 / profileUrl / avatar）
- ゲスト一覧（表示順）

## 2. ゲストデータ仕様
各ゲスト:
- `name`
- `profileUrl` または `profileLinks[]`
- `avatarUrl`
- 任意: `introducedBy`, `introducerAvatarUrl`

複数アカウント対応（momoko&なち方式）:
- `profileUrl` ではなく `profileLinks` を使う

## 3. 画像アセット配置
配置先:
- `/public/assets/events/vol-3/flyer-main.jpg`
- `/public/assets/events/vol-3/og-card.jpg`
- `/public/assets/events/vol-3/avatars/*.jpg|png`
- 任意: `/public/assets/events/vol-3/story-01.png` など

推奨:
- OG画像: `1200x630`
- アバター: 正方形 `600x600` 以上

## 4. フォーム導線
- 推薦フォーム: 既定で全回共通URLが表示される
- VOL.3で別フォームが必要なら `cta.recommendFormUrl` を上書き

## 5. リリース前チェック
- `node --check src/scripts/event-page.js`
- `python3 -m json.tool content/events/index.json`
- `python3 -m json.tool content/events/vol-3/event.json`
- `/events/vol-3/` の表示確認（SP優先）
- `/events/` の一覧確認

## 6. 公開切替手順
1. `content/events/vol-3/event.json` を本番値に更新
2. 画像を `public/assets/events/vol-3/` に配置
3. `content/events/index.json` の `latest` を `vol-3` に変更
4. `main` へ push
