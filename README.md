# workout-tracker

スマホで使う筋トレ・ランニング管理 Web アプリ(PWA)。データは端末内(localStorage)に保存します。

- 公開先: https://hatakekai0720-code.github.io/workout-tracker/
- 起動: `npm run serve` → http://localhost:8000
- テスト: `npm test`

## 公開(GitHub Pages)

ビルドは不要です。リポジトリの Settings → Pages で「Deploy from a branch」、ブランチ `main`、フォルダ `/ (root)` を選ぶと、`main` の内容がそのまま公開されます。

## ファイルを足したとき

`js/`・`css/`・`icons/` にファイルを足したら、`sw.js` の `PRECACHE` に追加して `VERSION` を上げてください(`npm test` が過不足を検出します)。
