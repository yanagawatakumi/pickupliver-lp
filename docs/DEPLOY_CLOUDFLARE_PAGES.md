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

## 新しい回を追加する時
1. `/Users/yana/Desktop/VoiceTree/30_web/projects/260221_PICKUPLIVER/content/events/vol-<n>/event.json` を追加
2. `/Users/yana/Desktop/VoiceTree/30_web/projects/260221_PICKUPLIVER/public/assets/events/vol-<n>/` に画像を追加
3. `/Users/yana/Desktop/VoiceTree/30_web/projects/260221_PICKUPLIVER/events/vol-<n>/index.html` を作成
4. `/Users/yana/Desktop/VoiceTree/30_web/projects/260221_PICKUPLIVER/content/events/index.json` の `latest` と `episodes` を更新
