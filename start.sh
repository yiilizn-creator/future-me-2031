#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "五年后的自己模拟器 → http://localhost:${PORT}"
python3 -m http.server "$PORT"
