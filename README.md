# PICKUPLIVER Website

単発イベント向けの1ページLPです。現在は `PICK UP LIVER VOL.1` 用の本番構成になっています。

## Current Status
- 公開先: Cloudflare Pages
- 公開URL: `https://pickupliver-lp.pages.dev`
- 更新方式: `main` ブランチへ push で自動デプロイ

## Key Files
- `/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/index.html` : ページ本体
- `/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/src/styles/main.css` : スタイルとアニメーション
- `/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/src/scripts/main.js` : データ反映と演出ロジック
- `/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/src/data/event.json` : イベント表示データ
- `/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/docs/REQUIREMENTS.md` : 最新要件定義
- `/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/docs/DEPLOY_CLOUDFLARE_PAGES.md` : 公開手順

## Operation Notes
- 定期クラッカーは停止中（必要なら再有効化）
- 入室時クラッカーとクリック時クラッカーは有効
- `prefers-reduced-motion` 対応済み

## Next Event Update
1. `src/data/event.json` を次回イベント情報に更新
2. `public/assets/events/<event-id>/` に画像を追加
3. 必要なら演出強度を調整
