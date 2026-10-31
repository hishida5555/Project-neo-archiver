# Project Neo Archiver

Adobe Project Neo のプロジェクトデータをローカルにバックアップ・アーカイブするためのツールです。
作成済みプロジェクトデータのダウンロード／再アップロードが可能です。

## 特徴

- **Chrome拡張版**: Node.js 不要。MV3 拡張として動作し、権限は `scripting` + `projectneo.adobe.com` のみ
- **ローカルサーバ/CLI版**: Node.js >=22 のみ（npm パッケージ不要。`node --test`/`node:http`/ネイティブ `WebSocket` を使用）
- **ネイティブ認証**: Adobe API 呼び出しは全て、ログイン済みの `projectneo.adobe.com` ページ上で実行します。認証トークンはサーバ内や管理下のファイルには保持しません（どちらの経路でも共通）

## 構成

```
├── manifest.json       # Chrome拡張定義 (MV3) — リポジトリ全体が拡張ルート
├── extension/          # 拡張固有実装 (background/index/ext-shim/ext-api/ext-lib/icons)
├── src/neo-ops.mjs     # ページ内実行オペレーション共有定義（CDP版・拡張版で共用）
├── src/neo-page.mjs    # CDP経由のページ実行レイヤ
├── src/server.mjs      # ローカルサーバ (GUI配信+API、pure node:http、127.0.0.1限定)
├── src/cdp.mjs         # 最小CDPクライアント (/json/* + WS Runtime.evaluate、依存ゼロ)
├── src/library.mjs     # library/ + meta.json 管理（sha256記録・パストラバーサル防御）
├── src/util.mjs        # safeName/uniqueName 等
├── public/             # GUI (index.html/app.js/ui.css、English UI・両経路で共用)
├── tools/launch-chrome.sh / .bat   # 専用profile+CDP Chrome 起動（べき等、macOS/Windows）
├── tools/pack-extension.sh         # 配布用拡張zip生成（CWS提出用・必要ファイルのみ同梱）
├── cli.mjs             # CLI (status/list/download/upload)
├── start.command / start.bat       # ダブルクリック起動（macOS Finder / Windows）
├── PRIVACY.md          # プライバシーポリシー（CWS提出用）
└── test/               # node --test
```

## 使い方

### Chrome拡張版（推奨・Node.js 不要）

1. `chrome://extensions` を開き、右上の「デベロッパーモード」をON
2. 「パッケージ化されていない拡張機能を読み込む」→ このリポジトリのルートを選択
3. ツールバーの拡張アイコンをクリック → アーカイバ画面がタブで開きます
4. `Select Local Library Folder` で保存先フォルダを選択・権限を付与
5. `projectneo.adobe.com` にログインしたタブがあれば自動で接続されます
   （無い場合はタブを開くので、そこでログインしてください）

画面は Download／Upload のタブ構成です。認証状態はタイトル横のランプ
（緑=認証済み・黄=匿名・赤=未接続）で示され、状態変化は自動で画面リロードに反映されます。

### ダブルクリック起動（ローカルサーバ版）

Finder で `start.command`（Windows では `start.bat`）をダブルクリックすると、
専用 Chrome とサーバが起動し、GUI が既定ブラウザで自動的に開きます
（macOSではターミナルウィンドウを、Windowsでは "Neo Archiver Server" ウィンドウを閉じると停止します）。
初回のみ、起動した Chrome で `projectneo.adobe.com` にログインしてください。

※ ダウンロードしたファイルは Gatekeeper にブロックされる場合があります。
  その場合は右クリック →「開く」で実行してください。

### 手動起動（CUI）

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

拡張版・サーバ版とも、Adobe API 呼び出しの核は `src/neo-ops.mjs` の `neoOp` で、
ログイン済み Neo ページの MAIN world で実行されます。経路の違いは「どうやって
ページ内コードを起動し、結果をファイルに落とすか」だけです。

```
[拡張ページ] ──executeScript(world:'MAIN')──→ [Neoページ内 neoOp] ←→ [project-neo.adobe.io]
     │ File System Access API                            認証済みfetch
     └→ ユーザ選択フォルダ (library/ 相当)
```

```
[ブラウザGUI] ←→ [server.mjs :8130] ←→ [CDP :9225] ←→ [Neoページ内 neoOp] ←→ [Adobe API]
                     │
                     └→ library/ (リポジトリ直下)
```

- ページ内 fetch はブラウザの認証コンテキストで実行されるため、
  IMS ログイン・トークン更新はネイティブアプリの仕組みに完全委譲されます
- server.mjs は GUI の配信・`library/` ファイル管理・操作の直列化のみを行い、
  Adobe との直接通信は行いません（トークン非保持＝サーバ側に秘匿情報なし）
- 拡張版はローカルサーバを立てず、ページ注入＋File System Access のみで完結します

## セキュリティ設計

ローカルサーバ版 (server.mjs) の対策：

| 対策 | 実装 |
|---|---|
| バインド | `127.0.0.1` のみ（外部から到達不可） |
| DNSリバインディング | `Host` ヘッダを `127.0.0.1`/`localhost`/`[::1]` に限定（他は403） |
| CSRF | `Sec-Fetch-Site` が `same-origin`/`none` 以外を拒否（クロスサイト POST を遮断） |
| CORS | ヘッダ非付与（同一オリジン GUI のみ。クロスオリジン利用を想定しない） |
| CSP | `default-src 'self'`、`object-src 'none'`、`base-uri 'none'` 等 |
| トークン | ページ内に留めてサーバ・管理下のファイルに一切保存しない |
| パストラバーサル | ファイル名は `^[\w.-]+$` 検証＋ディレクトリ containment 確認 |
| メソッド | GET/HEAD/POST のみ許可 |
| ボディ制限 | POST は 4MB、thumb b64 は 32MB 上限 |

拡張版の対策：

| 対策 | 実装 |
|---|---|
| 権限最小化 | `scripting` + `projectneo.adobe.com` host のみ（`debugger`/全ホスト権限なし） |
| ページ注入 | パッケージ内コードのみ実行（リモートコードなし。webpack チャンク push は 1 回/ページに制限し過剰実行を防止） |
| ファイル保存 | File System Access API のユーザ指定フォルダのみ。ファイル名検証はサーバ版と同規則 |
| トークン | ページ内に留めて拡張側・管理下のファイルに一切保存しない |

## 注意事項・前提

- **Adobe 利用規約 6.2(d)**: 「提供するインターフェース以外でのサービスアクセス禁止」が最も関連する条項。
  本ツールはページ内実行によりこの懸念を緩和する設計ですが、利用は自己責任で行ってください
- **上書き不可**: UL は常に新規プロジェクト作成です（REST 上書き経路は存在しません。
  既存プロジェクトへの反映は WebSocket `document_update` のみで、本ツールのスコープ外です）
- **サインアウト時の挙動**: ページが匿名状態（`localUser` 無し）の場合、一覧取得を拒否します。
  公開プロジェクト一覧が自分のプロジェクトのように表示されることを防ぐためです
- **ページ内部構造への依存**: webpack モジュールID等の Adobe 内部実装に依存するため、
  Adobe 側のデプロイで動作しなくなる可能性があります
- **テスト済み環境**: macOS + Chrome 156 + Node 24（拡張版は Chrome 102+、Windows も概ね同等）
- `library/`・`.chrome-profile/` は .gitignore 対象（個人データ・認証情報を含むため）

## ライセンス

配布時に決定（現時点では private）。
