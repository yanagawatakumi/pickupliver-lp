# 要件定義（最新）

## 1. ゴール
- 「PICK UP LIVER」各回の告知LPを同一リポジトリで継続運用できるようにする。
- 最新回の視聴導線を維持しつつ、過去回アーカイブにも遷移できるようにする。

## 2. スコープ
- In Scope
- 複数回LP（静的サイト）
- `/events/<slug>/` の回別ページ運用
- `/` から最新回への遷移
- `/events/` での回一覧表示
- 共通テンプレート + 回別JSONデータ運用
- Cloudflare Pages公開

- Out of Scope
- CMS導入
- 管理画面
- 問い合わせフォーム
- 独自ドメイン運用

## 3. 機能要件
- 各回ページは `meta[name="vt:event-data"]` で指定されたJSONを読み込み、DOM反映すること。
- CTAボタンで配信URLへ遷移できること。
- MC/ゲストのプロフィールリンク一覧を表示できること。
- `/` は `content/events/index.json` の `latest` へ遷移すること。
- `/events/` は `content/events/index.json` の `episodes` を一覧表示すること。

## 4. 非機能要件
- 無料運用可能であること（Cloudflare Pages + pages.dev）。
- `main` pushで自動デプロイされること。
- `prefers-reduced-motion` で演出を抑制できること。

## 5. UI/演出要件
- マルキー表示は有効。
- 常時粒子は有効（速度クランプ適用）。
- 入室時クラッカーは爆大で有効。
- 定期クラッカーは現時点で無効。
- クリック時クラッカーは有効。

## 6. データ要件
- 出演者/役割/リンクは `docs/データベース.xlsx` を正とする。
- 回別表示データは `content/events/<slug>/event.json` に保持する。
- 一覧と最新回は `content/events/index.json` で管理する。

## 7. 受け入れ条件
- `/` へアクセスすると最新回（現時点では `/events/vol-2/`）へ遷移する。
- `/events/` で `vol-1` と `vol-2` が表示される。
- SPでヒーロー上部（kicker + stickers）の配置が崩れない。
- CTA文言が `配信を視聴する` である。
- 高速すぎる異常粒子が出ない（速度上限内）。

## 8. 今後の変更点メモ
- 新回追加時は `content/events/vol-<n>/event.json` と `public/assets/events/vol-<n>/` を追加する。
- `content/events/index.json` の `latest` と `episodes` を更新する。
- 必要に応じて定期クラッカーを再有効化する。
