# Cloudflare Pages 公開手順（無料）

## 前提
- GitHubアカウント
- Cloudflareアカウント（無料）

## 手順
1. このプロジェクトをGitHubにpushする
2. Cloudflare Dashboard > Workers & Pages > Create application > Pages > Connect to Git
3. 対象リポジトリを選択
4. Build settings:
   - Framework preset: `None`
   - Build command: （空欄）
   - Build output directory: `/`
5. Deploy を実行
6. `*.pages.dev` の無料サブドメインで公開確認

## 更新方法
- ファイルを更新してGitHubにpushすると自動で再デプロイされる

## 次回イベント時
- `/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/src/data/event.json` を更新
- `/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/public/assets/events/<event-id>/` に画像追加
