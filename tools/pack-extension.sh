#!/bin/bash
# Chrome Web Store 提出用の拡張 zip を生成する（ホワイトリスト方式）。
# リポジトリ全体が拡張ルートだが、配布物には必要ファイルのみを含める。
# 使い方: bash tools/pack-extension.sh [version]   出力: dist/neo-archiver-ext-<version>.zip
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
VER="${1:-$(node -p "require('$ROOT/manifest.json').version")}"
STAGE="$ROOT/tmp/ext-pack"
OUT="$ROOT/dist"

rm -rf "$STAGE"
mkdir -p "$STAGE/extension/icons" "$STAGE/public" "$STAGE/src" "$OUT"

cd "$ROOT"
cp manifest.json "$STAGE/"
cp extension/background.js extension/index.html extension/ext-api.mjs extension/ext-lib.mjs extension/ext-shim.mjs "$STAGE/extension/"
cp extension/icons/*.png "$STAGE/extension/icons/"
cp public/app.js public/ui.css "$STAGE/public/"
cp -R public/fonts "$STAGE/public/"
cp src/neo-ops.mjs src/util.mjs "$STAGE/src/"

cd "$STAGE"
ZIP="$OUT/neo-archiver-ext-$VER.zip"
rm -f "$ZIP"
zip -qr "$ZIP" .
echo "wrote $ZIP ($(du -h "$ZIP" | cut -f1))"
unzip -l "$ZIP"
