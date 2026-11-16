# workout-tracker

スマホで使う筋トレ・ランニング管理 Web アプリ(PWA)。GitHub Pages で `main` をそのまま公開している:
https://hatakekai0720-code.github.io/workout-tracker/

利用者は日本語で、開発の経験はあまりない。説明・UI 文言・コメント・コミットメッセージはすべて日本語。

## 基本方針

- **ビルドなし**: 素の HTML / CSS / JavaScript(ES Modules)。npm の依存パッケージは使わない(`package.json` はテストとサーバー起動のスクリプトだけ)。
- **データは端末内だけ**: `localStorage` の `workoutTracker.data` に JSON 1 個。サーバーはない。
- **既存データを壊さない**: 利用者は公開版で実際に記録している。保存データの形を変えるときは、できるだけ項目を「任意」で足す形にし、古いデータとバックアップがそのまま読めるようにする(このときは `schemaVersion` を上げない)。
  - 足すだけでは済まない変更(名前や形を変える)は、`js/data/migrate.js` の `SCHEMA_VERSION` を上げ、`MIGRATIONS` に変換を1つ足し、`tests/migrate.test.js` にテストを足す。起動時とバックアップ取り込み時に自動で変換され、変換の前に自動バックアップが取られる。今は版1(変換はまだない)。
- **計算で出せる値は保存しない**(ペース、1RM、PR、継続日数、移動平均など)。
- **計算は DOM に触れないモジュールに分け、テストを付ける**。画面(`js/views/`)は薄く保つ。
- **見た目**: Windows XP 風(青いタイトルバーのウィンドウ、ベージュの地、タスクバー風の下タブ)。フォントは Noto Sans JP(`vendor/` に同梱)。色は `css/style.css` の CSS 変数で、ダークモードは `:root[data-theme="dark"]`。
- **外部ライブラリ**: Chart.js 4.6.1 は `vendor/` に同梱。Three.js 0.180.0 は jsDelivr から(`index.html` の importmap)。版を変えるときは `sw.js` の `CDN_PREFIX` もそろえる(テストで確認している)。

## よく使うコマンド

- テスト: `npm test`(node:test。DOM なしで動く)
- ローカル起動: `npm run serve` → http://localhost:8000
- ブラウザ確認: Playwright が使える(`require('playwright')`)。スマホ幅 390×844 で確認している。この作業環境からは jsDelivr に届かないので、3D の確認は `npm pack three@0.180.0` の中身をルートで返すなどして行う。

## ファイルを足したとき(必須)

`js/`(どの下位フォルダでも)・`css/`・`data/`・`icons/` にファイルを足したら、`sw.js` の `PRECACHE` に追加し、`VERSION` を 1 つ上げる。`npm test` が過不足を検出する。

## 構成

```
index.html            画面の枠、下タブ、ダイアログ、importmap
sw.js                 Service Worker(本体はネットワーク優先で HTTP キャッシュを通さない、フォントと CDN はキャッシュ優先)。
                      VERSION は js/ui/util.js の APP_VERSION とそろえる(設定画面に表示。テストで確認)。新しい版に切り替わると app.js が1回読み込み直す
data/exercises.json   種目カタログ(筋トレ50種目+ランニング)。解説・器具・難易度・効く筋肉など
css/style.css         すべてのスタイル
js/
  app.js              起動、タブ切替
  data/               保存まわり(読み書き・検証・バックアップ)
    store.js          保存データの読み書き(state はここだけが持つ)。起動時に自動バックアップと変換を行い、容量不足なら古い自動バックアップから消す
    migrate.js        保存データの版と、古い版からの自動変換
    autobackup.js     自動バックアップ(1日1回、その日に初めて開いたとき。直近3つ。キーは workoutTracker.autoBackup.<時刻>.<理由>)。設定画面から戻せる
    backup.js         バックアップ JSON の検証(受け取った値を作り直す。古い形も読む)
    guides.js         種目カタログの読み込みと、種目マスタとの統合(guideId で結びつく)
  logic/              計算・ルール(DOM にも保存先にも触れない。テストの対象)
    dates.js          日付(通し日数、週の月曜、日本語の表示)
    training.js       ペース・1RM・記録の要約・グラフ用の集計・週ごとの集計
    insights.js       PR・継続日数・今週のまとめ
    suggest.js        ホームの「次のメニュー提案」(ルールベース)
    muscles.js        筋肉の一覧(16種)
    musclemap.js      筋肉マップの集計(今週のセット数、回復の状態)
    schedule.js       予定(バイト・学校)の繰り返し展開、編集範囲、重なり、空き時間、振り替え候補
    program.js        自動メニュー作成(ルールで組み立てる)
    placement.js      プログラムを空き時間に自動配置
  ui/                 画面から使う道具(DOM に触れる)
    charts.js theme.js timer.js util.js
  mannequin/          筋肉マップのマネキン(楕円体だけで組む。1つの筋肉を筋頭ごとの楕円体に分ける。3D は Three.js で、筋線維のすじ模様・後ろからの光・足もとの影。2D は SVG)
                      3D は2本指ドラッグ/▲▼ボタンで上下に移動できる(左右・前後には動かない。向きのボタンで全身に戻る)
  views/              各画面(home, calendar, exercises, stats, body, settings と、各ダイアログ)
    program.js        自動メニュー作成ダイアログの入口(画面の切り替えとボタンの受け付け)
    program/          その画面ごとの中身: form(入力)・preview(確認)・place(日程に入れる)・state(共有の状態 ui)
tests/                各モジュールのテスト(memory-storage.js は localStorage の代わり)
```

置き場所の決まり: 計算やルールは `logic/`(DOM に触れない・テストを付ける)、保存・検証・バックアップは `data/`、画面は `views/`。
`logic/` から `views/` や `ui/` を読み込まない(読み込みは 画面 → ui / logic / data の向きだけ)。

## 保存データの形(主なもの)

- `exercises`: 種目マスタ。`id`、`name`、`kind`(strength/run)、`bodyPart`、`loadType`(weighted/bodyweight/timed)、`archived`。任意で `guideId`(カタログとの結びつき)、`muscles`、`note`、`customGuide`。
  - 最初の版の 7 種目(`ex_squat` など)は id を変えずにカタログへ結びつけている(`js/data/guides.js` の `LEGACY`)。利用者の「スクワット」は自重に変えて使われているので `bw_squat` に結びつく。
  - カタログの種目は起動時に足される。削除はできず、非表示(`archived`)にする。
- `entries`: トレーニングの予定と実績。`date`、`exerciseId`、`status`(planned/done)、`plan`、`actual`、`memo`。任意で `time`、`durationMin`、`rpe`、プログラム由来なら `programId`・`sessionKey`(1回ぶんの種目で共通)・`sessionLabel`。
- `bodyLogs`、`profile`、`settings`(テーマ、タイマー、`ownedEquipment`、`timeStepMin`、`dayStart`/`dayEnd` など)。
- `events`(予定)・`eventTemplates`・`terms`(学期): 形は `js/logic/schedule.js` の冒頭のコメント。
- `program`: 自動メニュー作成で保存したプログラム(1つだけ)。`config`、`templates`、`schedule`。

## 決めてきたルール(変える前に利用者に確認する)

- 提案: 達成なら +2.5kg(自重は +1 回、時間は +5 秒)、2回連続未達は据え置き。前日の部位は外す。ランは週 +10% 以内。
- 継続日数: 予定を入れた日のうち実施した日の連続。休養日では途切れない。
- 筋肉マップの色: メイン + サブ×0.5 のセット数(ラン1回=3セット相当)。回復は 48/72 時間で3段階。
- 自動メニュー作成: 週1〜3回は全身、4回は上下、5〜6回は押す/引く/脚。重点部位は週10〜20セット、それ以外は週12セットまで。4週ごとに軽めの週。
- 自動配置: 予定の前後30分を避ける。同じ部位は48時間以上空ける。夜=18〜22時など。ランは「筋トレと同じ日にしない」(`program.config.separateRun`、任意。新規作成では最初からオン)を選べる。オンなら筋トレの日を強く避け、空いている日がない週だけ注意つきで同じ日にする。オフ(古いプログラム)は従来どおり軽く避けるだけ。

## 作業の進め方

- 大きな依頼は、まず計画とデータの形を提案し、了承を得てから実装する。フェーズごとに止めて、確認方法(スマホで見る点)を伝える。
- 作業ブランチで開発し、プルリクエスト → 利用者がマージすると数分で公開される。利用者は GitHub の操作に慣れていないので、手順は具体的に書く。
- 変更のたびに `npm test` と、ブラウザでの操作確認を行う。実機でしか確かめられない点(音・振動・ピンチ・指でのドラッグ・共有シート)は「未確認」と明記する。
- 解説文やメニューは一般的な内容で、専門家の監修はない。その旨を画面に出している。
