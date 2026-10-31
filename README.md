# Project Neo Archiver

Adobe Project Neo のプロジェクトをローカルにバックアップ・アーカイブするための独立ツール。
ダウンロード／アップロード／ローカル保管に特化しており、オフラインスタジオやエクスポート機能は含みません。

## 特徴

- **依存ゼロ**: Node.js >=22 のみ（npm パッケージ不要。`node --test`/`node:http`/ネイティブ `WebSocket` を使用）
- **ネイティブ認証委譲**: Adobe API 呼び出しは全て、ログイン済み `projectneo.adobe.com` ページ内で実行（CDP `Runtime.evaluate`）。IMS トークンをサーバ・ファイルに一切保持しない設計
- **完全な往復**: ダウンロードした `*.neo.json` をそのまま `createProjectWithDocument` で再アップロード（byte-identical 検証済み）
- **サムネイル保全**: 一覧の `imageUrl` を DL 時に `library/thumbs/` へ保存。UL 時は `presigned-image-url` → `PUT` で新規プロジェクトへ添付
- **名前重複回避**: UL 時に既存プロジェクト名と衝突した場合 `name (2)`/`(3)`… と自動サフィックス

## 構成

```
├── src/server.mjs      # ローカルサーバ (GUI配信+API、pure node:http、127.0.0.1限定)
├── src/cdp.mjs         # 最小CDPクライアント (/json/* + WS Runtime.evaluate、依存ゼロ)
├── src/neo-page.mjs    # ページ内実行レイヤ (auth確保・list・download・upload・thumb)
├── src/library.mjs     # library/ + meta.json 管理（sha256記録・パストラバーサル防御）
├── src/util.mjs        # safeName/uniqueName 等
├── public/             # GUI (index.html/app.js/ui.css、English UI)
├── tools/launch-chrome.sh   # 専用profile+CDP Chrome 起動（べき等）
├── cli.mjs             # CLI (status/list/download/upload)
└── test/               # node --test
```

## 使い方

```bash
# 1) CDP 付き Chrome を起動（専用プロファイル・初回のみ Neo ログイン）
bash tools/launch-chrome.sh            # PORT=9225 既定、--user-data-dir=.chrome-profile

# 2) GUI サーバ起動
node src/server.mjs                    # http://127.0.0.1:8130
# オプション: --port 8140 --cdp http://127.0.0.1:9225 --lib ./library

# 3) ブラウザで http://127.0.0.1:8130 を開く
```

Chrome は `--remote-debugging-port` と専用 `--user-data-dir` で起動されます。
このプロファイルで `https://projectneo.adobe.com/` に一度ログインすれば、
以降は起動するだけで認証済みになります（認証はプロファイルに残ります）。

### CLI

```bash
node cli.mjs status                          # 認証状態確認
node cli.mjs list                            # プロジェクト一覧
node cli.mjs download --all                  # 全件 DL
node cli.mjs download --uuid <uuid>          # 個別 DL
node cli.mjs upload <file.neo.json>          # UL（重複名は自動サフィックス）
node cli.mjs upload x.json --no-dedup --no-thumb
```

## アーキテクチャ

```
[ブラウザ] ←→ [server.mjs :8130] ←→ [CDP :9225] ←→ [Neoページ内 evaluate] ←→ [project-neo.adobe.io]
   GUI          オーケストレーション    WebSocket      認証済みfetch            Adobe API
```

- server.mjs は GUI の配信・`library/` ファイル管理・操作の直列化のみを行い、
  Adobe との直接通信は行いません（トークン非保持＝サーバ側に秘匿情報なし）
- ページ内 fetch はブラウザの認証コンテキストで実行されるため、
  IMS ログイン・トークン更新はネイティブアプリの仕組みに完全委譲されます

## セキュリティ設計

| 対策 | 実装 |
|---|---|
| バインド | `127.0.0.1` のみ（外部から到達不可） |
| DNSリバインディング | `Host` ヘッダを `127.0.0.1`/`localhost`/`[::1]` に限定（他は403） |
| CSRF | `Sec-Fetch-Site` が `same-origin`/`none` 以外を拒否（クロスサイト POST を遮断） |
| CORS | ヘッダ非付与（同一オリジン GUI のみ。クロスオリジン利用を想定しない） |
| CSP | `default-src 'self'`、`object-src 'none'`、`base-uri 'none'` 等 |
| トークン | ページ内に留めてサーバ・ファイルに一切保存しない |
| パストラバーサル | ファイル名は `^[\w.-]+$` 検証＋ディレクトリ containment 確認 |
| メソッド | GET/HEAD/POST のみ許可 |
| ボディ制限 | POST は 4MB、thumb b64 は 32MB 上限 |

## 注意事項・前提

- **Adobe 利用規約 6.2(d)**: 「提供するインターフェース以外でのサービスアクセス禁止」が最も関連する条項。
  本ツールはページ内実行によりこの懸念を緩和する設計ですが、利用は自己責任で行ってください
- **上書き不可**: UL は常に新規プロジェクト作成です（REST 上書き経路は存在しません。
  既存プロジェクトへの反映は WebSocket `document_update` のみで、本ツールのスコープ外です）
- **テスト済み環境**: macOS + Chrome 156 + Node 24。Chrome DevTools Protocol に依存するため
  Chrome 側の変更で動作しなくなる可能性はあります
- `library/`・`.chrome-profile/` は .gitignore 対象（個人データ・認証情報を含むため）

## ライセンス

配布時に決定（現時点では private）。
