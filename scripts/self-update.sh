#!/usr/bin/env bash
# 자가 진화형 인프라 자동 갱신 스크립트.
#
# 모드:
#   self-update.sh                  → 정기 sync (매시간 cron). 자기 자신 + cron 정의 + 인프라 파일 sync.
#   self-update.sh --check-sentinel → 매분 sentinel 체크. data/.update-now 발견 시 docker compose pull + up.
#
# 동작:
#   1) self-update.sh 자체를 GitHub에서 fetch → 다르면 갱신 후 새 버전으로 재실행 (자가 진화)
#   2) /etc/cron.d/owlim-self-update를 latest 정의로 idempotent 갱신 (cron 자가 진화)
#   3) docker-compose.yml / Caddyfile fetch → 변경 시 docker compose up -d
#   4) src/ 코드 변경은 watchtower가 5분마다 별도로 처리.

set -uo pipefail

INSTALL_DIR=/opt/telegram-trading
SCRIPT_PATH="$INSTALL_DIR/scripts/self-update.sh"
REPO=https://raw.githubusercontent.com/codingcraftz/telegram-trading/main
LOG_PREFIX="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
MODE="${1:-sync}"

cd "$INSTALL_DIR" 2>/dev/null || { echo "$LOG_PREFIX install dir missing"; exit 1; }

# ===== 동시 실행 방지 =====
LOCK_FILE=/tmp/owlim-self-update.lock
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "$LOG_PREFIX 이전 sync 진행 중 — skip"; exit 0; }

# ===== sentinel 모드 (매분 cron) =====
if [ "$MODE" = "--check-sentinel" ]; then
  SENTINEL="$INSTALL_DIR/data/.update-now"
  if [ -f "$SENTINEL" ]; then
    rm -f "$SENTINEL"
    echo "$LOG_PREFIX 🚀 사용자 업데이트 요청 감지 — docker compose pull + up"
    docker compose pull 2>&1 | tail -15
    docker compose up -d --remove-orphans 2>&1 | tail -10
    echo "$LOG_PREFIX ✅ 업데이트 완료"
  fi
  exit 0
fi

# ===== sync 모드 =====

# --- 1) self-update.sh 자기 자신 갱신 (자가 진화) ---
tmp_self=$(mktemp)
if curl -fsSL --max-time 30 "$REPO/scripts/self-update.sh" -o "$tmp_self" \
   && [ -s "$tmp_self" ] && [ "$(wc -c < "$tmp_self")" -gt 500 ]; then
  if ! cmp -s "$tmp_self" "$SCRIPT_PATH"; then
    echo "$LOG_PREFIX 🔄 self-update.sh 자기 갱신"
    cp "$SCRIPT_PATH" "$SCRIPT_PATH.bak.$(date +%s)" 2>/dev/null || true
    chmod +x "$tmp_self"
    mv "$tmp_self" "$SCRIPT_PATH"
    # 새 버전으로 즉시 다시 실행 (현재 프로세스 교체)
    exec "$SCRIPT_PATH" sync
  fi
fi
rm -f "$tmp_self"

# --- 2) cron 정의 갱신 (idempotent) ---
EXPECTED_CRON=$(cat <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# 매시간 :05 정기 sync (인프라 파일 + 자기 자신)
5 * * * * root /opt/telegram-trading/scripts/self-update.sh >> /var/log/owlim-self-update.log 2>&1
# 매분 sentinel 체크 (대시보드 "지금 업데이트" 버튼 → data/.update-now 파일 생성)
* * * * * root /opt/telegram-trading/scripts/self-update.sh --check-sentinel >> /var/log/owlim-self-update.log 2>&1
CRON
)
CRON_FILE=/etc/cron.d/owlim-self-update
if [ ! -f "$CRON_FILE" ] || ! diff -q <(echo "$EXPECTED_CRON") "$CRON_FILE" >/dev/null 2>&1; then
  echo "$LOG_PREFIX 🔄 cron 정의 갱신"
  echo "$EXPECTED_CRON" > "$CRON_FILE"
  chmod 0644 "$CRON_FILE"
  systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true
fi

# --- 3) 인프라 파일 sync ---
changed=0
declare -a track=("docker-compose.yml" "infra/Caddyfile")

for f in "${track[@]}"; do
  tmp=$(mktemp)
  if ! curl -fsSL --max-time 30 "$REPO/$f" -o "$tmp"; then
    echo "$LOG_PREFIX fetch fail: $f (network?)"
    rm -f "$tmp"
    continue
  fi
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

# --- 4) 오래된 backup 정리 ---
find "$INSTALL_DIR" -maxdepth 2 -name "*.bak.*" -mtime +7 -delete 2>/dev/null || true

# --- 5) 변경 있으면 compose up ---
if [ "$changed" = "1" ]; then
  echo "$LOG_PREFIX docker compose up -d 실행"
  docker compose up -d --remove-orphans 2>&1 | tail -10
else
  echo "$LOG_PREFIX no change"
fi
