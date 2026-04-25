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

## 鬼ステージ クリア人数API（D1）設定
`/api/oni-clear` を動かすには、Pages Functions に D1 を `DB` 名でバインドする必要があります。

1. Cloudflare Dashboard > `D1` > `Create database`
2. 任意名でDBを作成（例: `pickupliver-game-db`）
3. Cloudflare Dashboard > `Workers & Pages` > 対象 `Pages` プロジェクト > `Settings` > `Functions` > `D1 bindings`
4. `Add binding`
   - Variable name: `DB`
   - D1 database: 作成したDBを選択
5. 保存後、`main` に push して再デプロイ
6. 動作確認:
   - `GET https://pickupliver-lp.pages.dev/api/oni-clear` が `ok: true` を返す
   - 鬼ステージクリア時に `あなたはX人目のクリア者です` が表示される

## 更新方法
- ファイルを更新してGitHubにpushすると自動で再デプロイされる

## L Singer Tower Battle（ランキングAPI）設定
`/api/l-singer-tower-scores` は D1 バインド `DB` を使用します。  
`/api/oni-clear` と同じ D1 でも別 D1 でも動作します（同じ `DB` に複数テーブルを作成可能）。

- エンドポイント:
  - `GET /api/l-singer-tower-scores` : 全期間 TOP10 を返す
  - `POST /api/l-singer-tower-scores` : `name, score, survivalSec, placedCount, runId` を保存
- `runId` は一意制約があり、同一プレイの二重投稿は `409` になる

## ローカル開発（静的確認）
APIを使わない画面確認は、プロジェクト直下で静的サーバー起動でOKです。

```bash
cd /Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER
python3 -m http.server 4173
```

- 確認URL: `http://localhost:4173/games/l-singer-tower-battle/`
- この方法ではランキングAPIは基本的に利用できません（`/api/*` がないため）

## ローカル開発（API込み確認）
Cloudflare Pages Functions + D1 を含めて確認する場合:

```bash
cd /Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER
npx wrangler pages dev . --d1 DB=<YOUR_D1_DATABASE_ID>
```

- `<YOUR_D1_DATABASE_ID>` は Cloudflare D1 の Database ID
- 上記起動で `/api/oni-clear` と `/api/l-singer-tower-scores` の両方をローカル確認できます

## 新しい回を追加する時
1. `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/content/events/vol-<n>/event.json` を追加
2. `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/public/assets/events/vol-<n>/` に画像を追加
3. `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/events/vol-<n>/index.html` を作成
4. `/Users/yana/Desktop/VoiceTree/40_web/projects/260221_PICKUPLIVER/content/events/index.json` の `latest` と `episodes` を更新
