#!/usr/bin/env bash
# 텔레그램 매매 봇 자동 설치 — owlim register 페이지에서 실행됨.
#
# 환경변수 (cloud-init이 미리 export):
#   SETUP_CALLBACK_URL  — owlim에서 진행 상황 받을 endpoint
#   SETUP_TOKEN         — owlim에서 발급한 인증 토큰
#
# 단계:
#   1. 시스템 패키지
#   2. Docker
#   3. docker-compose.yml + Caddyfile 다운로드
#   4. IP 확인 → sslip.io 도메인 생성
#   5. random 대시보드 비밀번호 생성 + bcrypt hash
#   6. .env 작성 (봇 키들은 빈값, 사용자가 대시보드에서 입력)
#   7. docker compose up
#   8. owlim에 callback (URL + 비밀번호)

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
say()   { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

INSTALL_DIR=/opt/telegram-trading
RAW_BASE=https://raw.githubusercontent.com/codingcraftz/telegram-trading/main

# ---------- callback 헬퍼 ----------
report() {
  local step="$1"; local message="$2"; shift 2
  if [ -n "${SETUP_CALLBACK_URL:-}" ] && [ -n "${SETUP_TOKEN:-}" ]; then
    local extra=""
    if [ "$#" -gt 0 ]; then extra="$1"; fi
    curl -fsS -X POST "$SETUP_CALLBACK_URL" \
      -H "content-type: application/json" \
      -d "{\"setup_token\":\"$SETUP_TOKEN\",\"step\":$step,\"message\":\"$message\"$extra}" \
      >/dev/null 2>&1 || warn "callback 실패 (계속 진행)"
  fi
  say "[$step/6] $message"
}

# ---------- 0) 환경 ----------
if [[ $EUID -ne 0 ]]; then
  error "root 권한 필요"
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

# ---------- 1) 시스템 패키지 ----------
report 1 "시스템 패키지 설치 중"
apt-get update -qq
apt-get install -y -qq curl ca-certificates

# ---------- 2) Docker ----------
report 2 "Docker 설치 중"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
fi
if ! docker compose version &>/dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi

# ---------- 3) compose 파일 다운로드 ----------
report 3 "봇 구성 파일 다운로드"
mkdir -p $INSTALL_DIR/infra $INSTALL_DIR/data
cd $INSTALL_DIR
curl -fsSL $RAW_BASE/docker-compose.yml -o docker-compose.yml
curl -fsSL $RAW_BASE/infra/Caddyfile -o infra/Caddyfile
curl -fsSL $RAW_BASE/infra/kis-mcp.Dockerfile -o infra/kis-mcp.Dockerfile

# external 서브모듈 (KIS MCP 빌드용)
if [ ! -d "external/open-trading-api" ]; then
  mkdir -p external
  git clone --depth 1 https://github.com/koreainvestment/open-trading-api external/open-trading-api 2>/dev/null || \
    warn "open-trading-api clone 실패 (kis-mcp 빌드 시 재시도)"
fi

# ---------- 4) IP + sslip.io 도메인 ----------
report 4 "도메인/HTTPS 설정 중"
PUBLIC_IP=$(curl -fsS https://api.ipify.org 2>/dev/null || curl -fsS https://ifconfig.me 2>/dev/null || echo "")
if [ -z "$PUBLIC_IP" ]; then
  error "공인 IP 확인 실패"
  exit 1
fi
DASHBOARD_DOMAIN="${PUBLIC_IP//./-}.sslip.io"

# ---------- 5) 대시보드 비밀번호 + bcrypt hash ----------
DASHBOARD_PASSWORD=$(openssl rand -base64 18 | tr -d '=+/' | cut -c1-20)
# Caddy 이미지로 bcrypt hash 생성
DASHBOARD_PASSWORD_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$DASHBOARD_PASSWORD" 2>/dev/null)

# ---------- 6) .env (봇 키는 비워두고 대시보드에서 입력) ----------
cat > $INSTALL_DIR/.env <<EOF
# 대시보드 (Caddy)
DASHBOARD_DOMAIN=$DASHBOARD_DOMAIN
DASHBOARD_PASSWORD_HASH=$DASHBOARD_PASSWORD_HASH
CADDY_EMAIL=

# 봇 (대시보드에서 입력 — runtime.env에 저장됨)
TELEGRAM_BOT_TOKEN=initial-empty-will-be-overridden-by-dashboard
ALLOWED_CHAT_IDS=0
KIS_MCP_URL=http://kis-mcp:3000/sse

# KIS — 처음엔 비어있음, 대시보드에서 입력
KIS_PAPER_APP_KEY=
KIS_PAPER_APP_SECRET=
KIS_PAPER_STOCK=
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_ACCT_STOCK=
KIS_ACCT_FUTURE=
KIS_PAPER_FUTURE=
KIS_HTS_ID=
KIS_PROD_TYPE=01

# 운영
MODE=paper
MAX_TRADE_KRW=1000000
MAX_OPEN_POSITIONS=5
COOLDOWN_SEC=300
DAILY_LOSS_KRW=300000
INTENT_TTL_MIN=5
LOG_LEVEL=info
EOF

# ---------- 7) docker compose up ----------
report 5 "이미지 다운로드 + 컨테이너 시작"
docker compose pull bot watchtower caddy 2>/dev/null || true
docker compose up -d --build

# Caddy가 Let's Encrypt 인증서 받을 시간 (HTTP-01 challenge)
sleep 10

# ---------- 8) 완료 callback ----------
DASHBOARD_URL="https://$DASHBOARD_DOMAIN"
report 6 "준비 완료" ",\"ip\":\"$PUBLIC_IP\",\"dashboard_url\":\"$DASHBOARD_URL\",\"password\":\"$DASHBOARD_PASSWORD\""

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo "  📋 설치 완료"
echo "  대시보드: $DASHBOARD_URL"
echo "  비밀번호: $DASHBOARD_PASSWORD"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
