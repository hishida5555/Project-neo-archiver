#!/bin/bash
# Project Neo Archiver 用 CDP Chrome 起動スクリプト（専用プロファイル・べき等）。
# このプロファイルで一度 projectneo.adobe.com にログインすれば、以降は起動するだけで認証済みになる。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PROFILE="${PROFILE:-$ROOT/.chrome-profile}"
PORT="${PORT:-9225}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if curl -sf --max-time 3 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "{\"already_running\":true,\"port\":$PORT}"; exit 0
fi

mkdir -p "$PROFILE"
# 起動前に前回異常終了の名残を除去（「ページを回復しますか」バブル抑止）
rm -f "$PROFILE"/Singleton* 2>/dev/null || true
python3 - "$PROFILE" <<'PY' 2>/dev/null || true
import json, os, sys
p = os.path.join(sys.argv[1], 'Local State')
if os.path.exists(p):
    try:
        d = json.load(open(p))
        d.setdefault('profile', {})['exit_type'] = 'Normal'
        d['profile']['exited_cleanly'] = True
        json.dump(d, open(p, 'w'))
    except Exception:
        pass
PY

nohup "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --hide-crash-restore-bubble \
  --no-first-run --no-default-browser-check \
  'https://projectneo.adobe.com/' >/dev/null 2>&1 &
sleep 3
curl -sf --max-time 10 "http://127.0.0.1:$PORT/json/version" | head -4
echo "Open https://projectneo.adobe.com/ in this Chrome and sign in once. Auth persists in $PROFILE"
