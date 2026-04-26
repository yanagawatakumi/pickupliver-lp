# PICKUPLIVER Website

複数回運用向けに再編した静的LPです。各回は `/events/<slug>/` で公開します。

## Current Status
- 公開先: Cloudflare Pages
- 公開URL: `https://pickupliver-lp.pages.dev`
- 更新方式: `main` ブランチへ push で自動デプロイ

## URL Structure
- `/` : 最新回へリダイレクト
- `/events/` : 回一覧ページ
- `/events/vol-1/` : VOL.1
- `/events/vol-2/` : VOL.2

## Key Files
- `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/src/templates/event-shell.html` : 共通ページDOMテンプレート
- `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/src/styles/event-page.css` : 共通スタイル
- `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/src/scripts/event-page.js` : 共通演出・描画ロジック
- `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/content/events/index.json` : 最新回と回一覧レジストリ
- `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/content/events/<slug>/event.json` : 回別データ

## Episode Add Flow
1. `content/events/vol-<n>/event.json` を追加
2. `public/assets/events/vol-<n>/` に画像を配置
3. `events/vol-<n>/index.html` を作成（`vt:event-data` を設定）
4. `content/events/index.json` の `episodes` と `latest` を更新

## Operation Notes
- 定期クラッカーは停止中（必要なら再有効化）
- 入室時クラッカーとクリック時クラッカーは有効
- `prefers-reduced-motion` 対応済み

## Change Verification Rule
- すべての修正後に、必ず検証を実施してから報告・反映すること。
- 最低限の検証項目:
- `src/scripts/event-page.js` の構文チェック（`node --check`）
- `content/events/index.json` と `content/events/*/event.json` の構文チェック（`python3 -m json.tool`）
- 変更箇所の画面確認（SPを優先、必要に応じてPCも確認）
- 差分確認（意図したファイル・行のみ変更されていること）
