# Project Neo Archiver

**日本語** | [English](README.md)

Adobe Project Neo のプロジェクトデータをローカルにバックアップ・アーカイブするための
**Chrome拡張**です。作成済みプロジェクトデータのダウンロード／再アップロードが可能です。

## 特徴

- **Node.js 不要**: MV3 拡張として完結。権限は `scripting` + `projectneo.adobe.com` のみ
- **ネイティブ認証**: Adobe API 呼び出しは全て、ログイン済みの `projectneo.adobe.com` ページ上で
  実行します。認証トークンは拡張側や管理下のファイルには一切保持しません
- **ローカル保存**: File System Access API で、ユーザが選んだフォルダに
  `*.neo.json` / `thumbs/` / `meta.json`（sha256・アップロード履歴を記録）を書き込みます

## 構成

```
├── manifest.json       # Chrome拡張定義 (MV3) — リポジトリ全体が拡張ルート
├── extension/          # 拡張固有実装
│   ├── background.js   #   アイコンクリックでアーカイバ画面を開く
│   ├── index.html      #   アーカイバ画面（public/ の UI を共用）
│   ├── ext-shim.mjs    #   fetch('/api/*') シム・thumb/ファイル差し替え・Library選択UI
│   ├── ext-api.mjs     #   APIハンドラ（executeScript で Neo タブ内 neoOp を実行）
│   ├── ext-lib.mjs     #   File System Access による library 管理
│   └── icons/
├── src/neo-ops.mjs     # ページ内実行オペレーション (neoOp: auth/list/download/thumb/create/uploadThumb/reload)
├── src/util.mjs        # safeName/uniqueName 等
├── public/             # GUI 共用資産 (app.js / ui.css)
├── tools/pack-extension.sh   # 配布用拡張zip生成（必要ファイルのみ同梱）
├── PRIVACY.md          # プライバシーポリシー（CWS提出用）
└── test/               # node --test（util のみ。実動作確認は拡張ページで行う）
```

## 使い方

1. `chrome://extensions` を開き、右上の「デベロッパーモード」をON
2. 「パッケージ化されていない拡張機能を読み込む」→ このリポジトリのルートを選択
3. ツールバーの拡張アイコンをクリック → アーカイバ画面がタブで開きます
4. `Select Local Library Folder` で保存先フォルダを選択・権限を付与
5. `projectneo.adobe.com` にログインしたタブがあれば自動で接続されます
   （無い場合はタブを開くので、そこでログインしてください）

### 画面

- **Download タブ**: リモートのプロジェクト一覧。カード選択または Download all で一括DL
- **Upload タブ**: ローカルライブラリ。選択ファイルを再アップロード（常に新規プロジェクト作成。
  既存名と衝突した場合は `name (2)` の自動サフィックス）
- **認証ランプ**（タイトル横）: 緑=認証済み・黄=匿名・赤=未接続。クリックで再確認。
  状態変化はポーリングで検出し、画面を自動リロードします
- **詳細バルーン**: カードにホバーで uuid・owner・日付・sha256・アップロード履歴を表示
- **Cancel**: 一括処理中にプログレス行から中断可能

## アーキテクチャ

```
[拡張ページ] ──executeScript(world:'MAIN')──→ [Neoページ内 neoOp] ←→ [project-neo.adobe.io]
     │ File System Access API                            認証済みfetch
     └→ ユーザ選択フォルダ (library/ 相当)
```

- ページ内 fetch はブラウザの認証コンテキストで実行されるため、
  IMS ログイン・トークン更新はネイティブアプリの仕組みに完全委譲されます
- ローカルサーバ・CDP・外部プロセスは一切使いません

## セキュリティ設計

| 対策 | 実装 |
|---|---|
| 権限最小化 | `scripting` + `projectneo.adobe.com` host のみ（`debugger`/全ホスト権限なし） |
| ページ注入 | パッケージ内コードのみ実行（リモートコードなし。webpack チャンク push は 1 回/ページに制限し過剰実行を防止） |
| ファイル保存 | File System Access API のユーザ指定フォルダのみ。ファイル名は `^[\w.-]+$` 検証 |
| トークン | ページ内に留めて拡張側・管理下のファイルに一切保存しない |
| 匿名ガード | `localUser` 未確定の場合は一覧取得を拒否（公開一覧の誤表示を防止） |

## 注意事項・前提

- **Adobe 利用規約 6.2(d)**: 「提供するインターフェース以外でのサービスアクセス禁止」が最も関連する条項。
  本ツールはページ内実行によりこの懸念を緩和する設計ですが、利用は自己責任で行ってください
- **上書き不可**: UL は常に新規プロジェクト作成です（REST 上書き経路は存在しません。
  既存プロジェクトへの反映は WebSocket `document_update` のみで、本ツールのスコープ外です）
- **ページ内部構造への依存**: webpack モジュールID等の Adobe 内部実装に依存するため、
  Adobe 側のデプロイで動作しなくなる可能性があります
- **テスト済み環境**: Chrome 102+（macOS・Windows で概ね同等）
- `library/` は .gitignore 対象（個人データを含むため）

## 配布

```bash
bash tools/pack-extension.sh     # dist/neo-archiver-ext-<version>.zip を生成
```

ホワイトリスト方式で必要ファイルのみを同梱します。Chrome Web Store 提出時は
`PRIVACY.md` をプライバシーポリシーURLとして利用できます。

## ライセンス

[MIT](LICENSE)。同梱フォント（`public/fonts/`）は SIL Open Font License 1.1。

本ツールは非公式であり、Adobe とは無関係です。
