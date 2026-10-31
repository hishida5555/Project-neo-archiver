#!/bin/bash
# Project Neo Archiver — ダブルクリック起動用（macOS）
# 専用 Chrome (CDP) → ローカルサーバ → GUI を既定ブラウザで開く。
# このウィンドウを閉じるとサーバも停止します。
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8130}"
URL="http://127.0.0.1:$PORT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。Node.js >= 22 をインストールしてください。"
  read -r -p "Enter で終了: " _
  exit 1
fi

echo "== Chrome (CDP) 起動 =="
bash tools/launch-chrome.sh || echo "警告: Chrome の起動に失敗しました（未インストール?）"

echo "== サーバ起動: $URL =="
if curl -sf --max-time 2 "$URL/" -o /dev/null 2>&1; then
  echo "（既に起動しています）"
else
  node src/server.mjs &
  SRV=$!
  trap 'kill "$SRV" 2>/dev/null' EXIT
  for _ in {1..20}; do
    curl -sf --max-time 1 "$URL/" -o /dev/null 2>&1 && break
    sleep 0.5
  done
fi

echo "== ブラウザで GUI を開きます: $URL =="
open "$URL"

[ -n "${SRV:-}" ] && wait "$SRV"
exit 0
