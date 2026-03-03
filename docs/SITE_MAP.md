# Site Map（現行）

- `/` : 最新回へリダイレクト
- `/events/` : 回一覧ページ
- `/events/vol-1/`
- `/events/vol-2/`

## 実装メモ
- 回ページは `src/templates/event-shell.html` を共通利用
- 回データは `content/events/<slug>/event.json` を参照
- 一覧・最新回は `content/events/index.json` を参照
- 演出は `src/styles/event-page.css` と `src/scripts/event-page.js` で制御
