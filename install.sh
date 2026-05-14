#!/usr/bin/env bash
# 텔레그램 매매 봇 자동 설치 스크립트.
# Vultr/AWS/일반 Ubuntu 서버에서 한 줄 실행:
#   curl -fsSL https://raw.githubusercontent.com/codingcraftz/telegram-trading/main/install.sh | bash
# 또는 git clone 후:
#   bash install.sh

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

say()   { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

# ---------- 1) 루트 권한 + OS 체크 ----------
if [[ $EUID -ne 0 ]]; then
  error "root 권한이 필요합니다. 다음과 같이 실행하세요:"
  echo "  sudo bash $0"
  exit 1
fi

if ! command -v apt-get &>/dev/null; then
  error "Ubuntu/Debian 전용입니다."
  exit 1
fi

INSTALL_DIR=/opt/telegram-trading
REPO=https://github.com/codingcraftz/telegram-trading.git

# ---------- 2) 시스템 패키지 ----------
say "시스템 패키지 업데이트 (1~2분 소요)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git

# ---------- 3) Docker ----------
if ! command -v docker &>/dev/null; then
  say "Docker 설치 중"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
if ! docker compose version &>/dev/null; then
  say "Docker Compose plugin 설치"
  apt-get install -y -qq docker-compose-plugin
fi

# ---------- 4) 코드 다운로드 ----------
mkdir -p $INSTALL_DIR
cd $INSTALL_DIR
if [ ! -d ".git" ]; then
  say "봇 코드 다운로드"
  git clone $REPO . >/dev/null 2>&1 || {
    error "git clone 실패 — 인터넷 연결 또는 repo 권한 확인"
    exit 1
  }
else
  say "기존 코드 업데이트"
  git pull --rebase >/dev/null 2>&1 || warn "git pull 실패 (변경 사항 충돌 가능)"
fi

# ---------- 5) .env 입력 ----------
ENV_FILE=$INSTALL_DIR/.env
if [ -f "$ENV_FILE" ]; then
  warn ".env 이미 있음 — 그대로 사용 (재입력 필요하면 rm $ENV_FILE)"
else
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}    환경 변수 입력 — 차근차근${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo ""

  echo "1. 텔레그램 봇 토큰 (BotFather에서 받은 거)"
  echo "   예: 1234567890:ABCdefGHIjklMNopqrsTUVwxyz"
  read -rp "   > " TG_TOKEN

  echo ""
  echo "2. 허용할 텔레그램 chat_id (콤마 구분)"
  echo "   본인 chat_id 확인: 텔레그램에서 @userinfobot 검색 → /start"
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
# ============================================================
# 필수
# ============================================================
TELEGRAM_BOT_TOKEN=$TG_TOKEN
ALLOWED_CHAT_IDS=$CHAT_IDS

# ============================================================
# KIS 모의투자
# ============================================================
KIS_PAPER_APP_KEY=$KIS_PAPER_KEY
KIS_PAPER_APP_SECRET=$KIS_PAPER_SECRET
KIS_PAPER_STOCK=$KIS_PAPER_STOCK

# ============================================================
# 실전 (나중에 키 받으면 추가)
# ============================================================
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_ACCT_STOCK=
KIS_ACCT_FUTURE=
KIS_PAPER_FUTURE=
KIS_HTS_ID=
KIS_PROD_TYPE=01

# ============================================================
# 운영
# ============================================================
MODE=paper
MAX_TRADE_KRW=1000000
MAX_OPEN_POSITIONS=5
COOLDOWN_SEC=300
DAILY_LOSS_KRW=300000
INTENT_TTL_MIN=5
LOG_LEVEL=info
EOF
  say ".env 저장 완료"
fi

# ---------- 6) 봇 시작 ----------
say "Docker 이미지 빌드 + 봇 시작 (3~5분, 처음만)"
docker compose up -d --build

# ---------- 7) KRX 종목 마스터 다운로드 ----------
say "KRX 종목 마스터 다운로드 (3,500여 종)"
sleep 3
docker compose exec -T bot pnpm fetch:symbols 2>/dev/null || \
  warn "마스터 다운로드 실패 — 봇은 alias로 동작. 나중에 'docker compose exec bot pnpm fetch:symbols'로 재시도."
docker compose restart bot >/dev/null

# ---------- 완료 ----------
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}    설치 완료!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo "텔레그램에서 본인 봇 검색 → /시작"
echo ""
echo "📋 자주 쓰는 명령어:"
echo "  로그 보기:   cd $INSTALL_DIR && docker compose logs -f bot"
echo "  재시작:      cd $INSTALL_DIR && docker compose restart bot"
echo "  종료:        cd $INSTALL_DIR && docker compose down"
echo "  업데이트:    cd $INSTALL_DIR && git pull && docker compose up -d --build"
echo ""
echo "⚠️  종목 마스터는 매일 새벽에 자동 갱신 권장 (cron):"
echo "    0 7 * * 1-5 cd $INSTALL_DIR && docker compose exec -T bot pnpm fetch:symbols"
echo ""
