#!/usr/bin/env bash
# 이미 깔린 서버에 self-update 메커니즘 1회 부트스트랩.
# 사용:
#   ssh root@<server>
#   curl -fsSL https://raw.githubusercontent.com/codingcraftz/telegram-trading/main/scripts/bootstrap-self-update.sh | bash
#
# 신규 설치는 install.sh가 자동으로 처리하므로 이 스크립트 불필요.

set -euo pipefail

INSTALL_DIR=/opt/telegram-trading
RAW_BASE=https://raw.githubusercontent.com/codingcraftz/telegram-trading/main

if [[ $EUID -ne 0 ]]; then
  echo "✗ root 권한 필요"
  exit 1
fi

if [ ! -d "$INSTALL_DIR" ]; then
  echo "✗ $INSTALL_DIR 없음 — install.sh로 신규 설치하세요"
  exit 1
fi

echo "▶ self-update.sh 설치"
mkdir -p "$INSTALL_DIR/scripts"
curl -fsSL "$RAW_BASE/scripts/self-update.sh" -o "$INSTALL_DIR/scripts/self-update.sh"
chmod +x "$INSTALL_DIR/scripts/self-update.sh"

echo "▶ cron 등록 (매시간 5분에 실행)"
cat > /etc/cron.d/owlim-self-update <<EOF
# Owlim 트레이딩 봇 인프라 자동 갱신
# - docker-compose.yml / Caddyfile 변경 시 자동 적용
# - src/ 코드는 watchtower가 별도로 5분마다 갱신
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
5 * * * * root $INSTALL_DIR/scripts/self-update.sh >> /var/log/owlim-self-update.log 2>&1
EOF
chmod 0644 /etc/cron.d/owlim-self-update

# 시스템에 따라 cron 재로드 (Debian/Ubuntu)
if command -v systemctl &>/dev/null; then
  systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true
fi

echo "▶ 1회 즉시 실행 (변경 사항 즉시 반영)"
"$INSTALL_DIR/scripts/self-update.sh" || true

echo ""
echo "✅ self-update 부트스트랩 완료"
echo "   매시간 :05에 자동 sync"
echo "   로그: tail -f /var/log/owlim-self-update.log"
