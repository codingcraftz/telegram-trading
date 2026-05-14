#!/usr/bin/env bash
# 인프라 파일 (docker-compose.yml, Caddyfile) 자동 갱신.
# cron으로 매시간 실행됨. src/ 코드는 watchtower가 별도로 5분마다 갱신.
#
# 동작:
#   1) GitHub raw에서 최신 docker-compose.yml + Caddyfile fetch
#   2) 현재 파일과 sha256 비교
#   3) 변경 있으면 새 파일로 덮어쓰기 + docker compose up -d
#   4) .env / data/ 는 절대 안 건드림

set -uo pipefail

INSTALL_DIR=/opt/telegram-trading
REPO=https://raw.githubusercontent.com/codingcraftz/telegram-trading/main
LOG_PREFIX="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"

cd "$INSTALL_DIR" || { echo "$LOG_PREFIX install dir missing"; exit 1; }

# 동시 실행 방지 (cron이 겹치면 일관성 깨짐)
exec 200>/tmp/owlim-self-update.lock
flock -n 200 || { echo "$LOG_PREFIX 이전 sync 진행 중 — skip"; exit 0; }

changed=0
declare -a track=("docker-compose.yml" "infra/Caddyfile")

for f in "${track[@]}"; do
  tmp=$(mktemp)
  if ! curl -fsSL --max-time 30 "$REPO/$f" -o "$tmp"; then
    echo "$LOG_PREFIX fetch fail: $f (network?)"
    rm -f "$tmp"
    continue
  fi
  # 빈 파일이거나 너무 작으면 의심 → skip
  if [ ! -s "$tmp" ] || [ "$(wc -c < "$tmp")" -lt 50 ]; then
    echo "$LOG_PREFIX suspicious empty/small fetch: $f"
    rm -f "$tmp"
    continue
  fi
  mkdir -p "$(dirname "$f")"
  if [ ! -f "$f" ] || ! cmp -s "$tmp" "$f"; then
    cp "$f" "$f.bak.$(date +%s)" 2>/dev/null || true
    mv "$tmp" "$f"
    echo "$LOG_PREFIX updated: $f"
    changed=1
  else
    rm -f "$tmp"
  fi
done

# 오래된 backup 정리 (7일 이상)
find "$INSTALL_DIR" -maxdepth 2 -name "*.bak.*" -mtime +7 -delete 2>/dev/null || true

if [ "$changed" = "1" ]; then
  echo "$LOG_PREFIX docker compose up -d 실행"
  docker compose up -d 2>&1 | tail -10
else
  echo "$LOG_PREFIX no change"
fi
