#!/usr/bin/env bash
# 텔레그램 매매 봇 자동 설치 스크립트.
# Vultr/AWS/일반 Ubuntu 서버에서 한 줄 실행:
#   curl -fsSL https://raw.githubusercontent.com/codingcraftz/telegram-trading/main/install.sh | sudo bash
#
# Docker 이미지는 GHCR(GitHub Container Registry)에서 pre-built 받음.
# Watchtower가 5분마다 새 이미지 자동 감지 + 봇 재시작.
# → 개발자 push만 하면 모든 사용자 서버에 5분 이내 자동 반영.

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

say()   { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

# ---------- 1) 루트 권한 + OS 체크 ----------
if [[ $EUID -ne 0 ]]; then
  error "root 권한이 필요합니다. 다음과 같이 실행:"
  echo "  curl -fsSL https://raw.githubusercontent.com/codingcraftz/telegram-trading/main/install.sh | sudo bash"
  exit 1
fi

if ! command -v apt-get &>/dev/null; then
  error "Ubuntu/Debian 전용입니다."
  exit 1
fi

INSTALL_DIR=/opt/telegram-trading
COMPOSE_URL=https://raw.githubusercontent.com/codingcraftz/telegram-trading/main/docker-compose.yml
MCP_DOCKERFILE_URL=https://raw.githubusercontent.com/codingcraftz/telegram-trading/main/infra/kis-mcp.Dockerfile

# ---------- 2) 시스템 패키지 ----------
say "시스템 패키지 업데이트 (1~2분)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates

# ---------- 3) Docker ----------
if ! command -v docker &>/dev/null; then
  say "Docker 설치 중"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
if ! docker compose version &>/dev/null; then
  say "Docker Compose plugin 설치"
  apt-get install -y -qq docker-compose-plugin
fi

# ---------- 4) 작업 디렉토리 + compose 파일 ----------
mkdir -p $INSTALL_DIR/infra $INSTALL_DIR/data
cd $INSTALL_DIR

say "docker-compose.yml 다운로드"
curl -fsSL $COMPOSE_URL -o docker-compose.yml
mkdir -p infra
curl -fsSL $MCP_DOCKERFILE_URL -o infra/kis-mcp.Dockerfile

# ---------- 5) .env 입력 ----------
ENV_FILE=$INSTALL_DIR/.env
if [ -f "$ENV_FILE" ]; then
  warn ".env 이미 있음 — 그대로 사용 (재입력 필요하면 rm $ENV_FILE)"
else
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}    환경 변수 입력${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo ""

  echo "1. 텔레그램 봇 토큰 (BotFather에서 받은 거)"
  read -rp "   > " TG_TOKEN

  echo ""
  echo "2. 허용할 텔레그램 chat_id (콤마 구분)"
  echo "   본인 chat_id 확인: 텔레그램에서 @userinfobot → /start"
  read -rp "   > " CHAT_IDS

  echo ""
  echo "3. KIS 모의투자 APP_KEY"
  echo "   한국투자증권 개발자센터 → 모의투자 신청 → 키 발급"
  read -rp "   > " KIS_PAPER_KEY

  echo ""
  echo "4. KIS 모의투자 APP_SECRET"
  read -rp "   > " KIS_PAPER_SECRET

  echo ""
  echo "5. 모의투자 종합계좌 앞 8자리 (예: 50012345-01 → 50012345)"
  read -rp "   > " KIS_PAPER_STOCK

  cat > "$ENV_FILE" <<EOF
TELEGRAM_BOT_TOKEN=$TG_TOKEN
ALLOWED_CHAT_IDS=$CHAT_IDS

KIS_PAPER_APP_KEY=$KIS_PAPER_KEY
KIS_PAPER_APP_SECRET=$KIS_PAPER_SECRET
KIS_PAPER_STOCK=$KIS_PAPER_STOCK

# 실전은 나중에
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_ACCT_STOCK=
KIS_ACCT_FUTURE=
KIS_PAPER_FUTURE=
KIS_HTS_ID=
KIS_PROD_TYPE=01

MODE=paper
MAX_TRADE_KRW=1000000
MAX_OPEN_POSITIONS=5
COOLDOWN_SEC=300
DAILY_LOSS_KRW=300000
INTENT_TTL_MIN=5
LOG_LEVEL=info
EOF
  say ".env 저장"
fi

# ---------- 6) external 서브모듈 (KIS MCP 빌드용) ----------
# kis-mcp.Dockerfile은 external/open-trading-api 클론을 시도. 사전 다운로드.
if [ ! -d "external/open-trading-api" ]; then
  say "KIS Open Trading API 다운로드 (kis-mcp 이미지용)"
  mkdir -p external
  git clone --depth 1 https://github.com/koreainvestment/open-trading-api external/open-trading-api 2>/dev/null || \
    warn "open-trading-api clone 실패 — kis-mcp 빌드 시 다시 시도됨"
fi

# ---------- 7) 봇 시작 ----------
say "이미지 pull + 봇 시작 (3~5분, kis-mcp 첫 빌드)"
docker compose pull bot watchtower 2>/dev/null || true
docker compose up -d --build

# ---------- 완료 ----------
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}    설치 완료!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo "텔레그램에서 본인 봇 검색 → /시작"
echo ""
echo "📋 자주 쓰는 명령:"
echo "  로그:     cd $INSTALL_DIR && docker compose logs -f bot"
echo "  재시작:    cd $INSTALL_DIR && docker compose restart bot"
echo "  종료:     cd $INSTALL_DIR && docker compose down"
echo "  강제 갱신:  cd $INSTALL_DIR && docker compose pull bot && docker compose up -d bot"
echo ""
echo "✨ 자동 업데이트:"
echo "   Watchtower가 5분마다 GHCR 새 이미지 체크 → 발견 시 자동 반영"
echo "   (개발자가 push하면 5~10분 안에 봇 자동 업데이트)"
echo ""
