#!/usr/bin/env bash
# 텔레그램 매매 봇 자동 설치 — owlim register 페이지에서 실행됨.
#
# 환경변수 (cloud-init이 미리 export):
#   SETUP_CALLBACK_URL  — owlim에서 진행 상황 받을 endpoint
#   SETUP_TOKEN         — owlim에서 발급한 인증 토큰
#
# 단계 (1~6, owlim UI와 동일):
#   1. 시스템 패키지
#   2. Docker
#   3. 봇 구성 다운로드
#   4. 도메인/HTTPS 설정 + bcrypt 비번
#   5. 컨테이너 시작 (이미지 pull + up + 인증서 발급) ─ 가장 오래 걸림 (3~7분)
#   6. 준비 완료 (대시보드 URL + 비밀번호 반환)

# set -e 제외 — 일부 단계 실패해도 6번 callback은 무조건 보내기 위함
set -uo pipefail
trap 'report_failure $?' ERR EXIT

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
say()   { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

INSTALL_DIR=/opt/telegram-trading
RAW_BASE=https://raw.githubusercontent.com/codingcraftz/telegram-trading/main
DIAG_MAX_BYTES=10000  # progress route가 12KB cap이라 안전선 10KB

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

# 진단 정보 — JSON-safe 인코딩 + 크기 cap
collect_diagnostics() {
  local raw
  raw=$({
    echo "=== docker compose ps ==="
    docker compose -f "$INSTALL_DIR/docker-compose.yml" ps 2>&1 | head -30
    echo ""
    echo "=== bot logs (50줄) ==="
    docker compose -f "$INSTALL_DIR/docker-compose.yml" logs --tail 50 bot 2>&1
    echo ""
    echo "=== caddy logs (30줄) ==="
    docker compose -f "$INSTALL_DIR/docker-compose.yml" logs --tail 30 caddy 2>&1
    echo ""
    echo "=== install log (마지막 80줄) ==="
    tail -80 /var/log/owlim-install.log 2>/dev/null
  } 2>&1)
  # 끝에서 DIAG_MAX_BYTES만 잘라 (최신 로그가 더 가치 있음)
  raw="${raw: -$DIAG_MAX_BYTES}"
  echo "$raw" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" 2>/dev/null \
    || echo '"diagnostics encoding failed"'
}

# 어떤 단계에서 실패해도 마지막 callback (failed) 보내기
report_failure() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ] && [ -n "${SETUP_CALLBACK_URL:-}" ] && [ -n "${SETUP_TOKEN:-}" ]; then
    local diag
    diag=$(collect_diagnostics)
    curl -fsS -X POST "$SETUP_CALLBACK_URL" \
      -H "content-type: application/json" \
      -d "{\"setup_token\":\"$SETUP_TOKEN\",\"step\":6,\"message\":\"설치 중 오류 (exit=$exit_code)\",\"failed\":true,\"diagnostics\":$diag}" \
      >/dev/null 2>&1 || true
  fi
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

# ---------- 4) IP + sslip.io 도메인 + PIN bcrypt + 세션 secret ----------
report 4 "도메인/HTTPS 설정 중"
PUBLIC_IP=$(curl -fsS https://api.ipify.org 2>/dev/null || curl -fsS https://ifconfig.me 2>/dev/null || echo "")
if [ -z "$PUBLIC_IP" ]; then
  error "공인 IP 확인 실패"
  exit 1
fi
DASHBOARD_DOMAIN="${PUBLIC_IP//./-}.sslip.io"

# 대시보드 PIN — owlim 등록 페이지가 cloud-init env 로 DASHBOARD_PIN 6자리 숫자를 주입.
# 수동 설치 등 누락 시 6자리 난수 fallback (사용자가 콘솔에서 확인해야 함).
DASHBOARD_PIN="${DASHBOARD_PIN:-$(printf '%06d' $((RANDOM * 32768 + RANDOM)) | tail -c 7 | head -c 6)}"
if ! [[ "$DASHBOARD_PIN" =~ ^[0-9]{6}$ ]]; then
  error "DASHBOARD_PIN 형식 오류 (6자리 숫자 필요): $DASHBOARD_PIN"
  exit 1
fi
say "PIN bcrypt hash 생성 중"
DASHBOARD_PIN_HASH=$(timeout 120 docker run --rm caddy:2-alpine caddy hash-password --plaintext "$DASHBOARD_PIN" 2>/dev/null) || {
  error "bcrypt hash 생성 실패 (caddy 이미지 pull 또는 실행 실패)"
  exit 1
}
# bcrypt hash 는 $2a$14$... 형태로 $ 문자 다수 포함. docker-compose 는 .env 의 ${VAR}/$VAR 을
# expansion 하려고 해서 깨짐. $ → $$ escape 하면 docker-compose 가 unescape 해서 컨테이너에 정상 전달.
DASHBOARD_PIN_HASH_ENV="${DASHBOARD_PIN_HASH//\$/\$\$}"
# 쿠키 서명용 32바이트 hex secret (HMAC key)
DASHBOARD_SESSION_SECRET=$(openssl rand -hex 32)

# .env (봇 키는 비워두고 대시보드에서 입력)
# CADDY_EMAIL 은 빈값이면 Caddy 'email' 지시문이 syntax error → 도메인 기반 dummy 자동 채움.
cat > $INSTALL_DIR/.env <<EOF
DASHBOARD_DOMAIN=$DASHBOARD_DOMAIN
DASHBOARD_PIN_HASH=$DASHBOARD_PIN_HASH_ENV
DASHBOARD_SESSION_SECRET=$DASHBOARD_SESSION_SECRET
CADDY_EMAIL=admin@$DASHBOARD_DOMAIN

# ALLOWED_CHAT_IDS=1은 placeholder. 대시보드에서 본인 chat_id로 덮어쓰기 전엔 어떤 chat도 통과 안 함.
TELEGRAM_BOT_TOKEN=initial-empty-will-be-overridden-by-dashboard
ALLOWED_CHAT_IDS=1

KIS_PAPER_APP_KEY=
KIS_PAPER_APP_SECRET=
KIS_PAPER_STOCK=
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_ACCT_STOCK=
KIS_PROD_TYPE=01

MODE=paper
MAX_TRADE_KRW=1000000
MAX_OPEN_POSITIONS=5
COOLDOWN_SEC=300
DAILY_LOSS_KRW=300000
INTENT_TTL_MIN=5
LOG_LEVEL=info
EOF

# self-update (cron) 설치 — 인프라 자동 갱신 + 대시보드 "지금 업데이트" 버튼 트리거
mkdir -p $INSTALL_DIR/scripts
curl -fsSL $RAW_BASE/scripts/self-update.sh -o $INSTALL_DIR/scripts/self-update.sh
chmod +x $INSTALL_DIR/scripts/self-update.sh
cat > /etc/cron.d/owlim-self-update <<CRONEOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# 매시간 :05 정기 sync
5 * * * * root $INSTALL_DIR/scripts/self-update.sh >> /var/log/owlim-self-update.log 2>&1
# 매분 sentinel 체크 (대시보드 업데이트 버튼)
* * * * * root $INSTALL_DIR/scripts/self-update.sh --check-sentinel >> /var/log/owlim-self-update.log 2>&1
CRONEOF
chmod 0644 /etc/cron.d/owlim-self-update
systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true

# ---------- 5) 이미지 pull + 컨테이너 시작 + Let's Encrypt ----------
report 5 "이미지 다운로드 중 (3~5분 소요)"
timeout 300 docker compose pull 2>&1 | tail -20 || warn "pull 일부 실패 또는 5분 timeout"

report 5 "컨테이너 시작 + 인증서 발급 중 (1~2분 소요)"
timeout 120 docker compose up -d 2>&1 | tail -20 || warn "compose up 일부 실패 또는 2분 timeout"

# Caddy가 Let's Encrypt HTTP-01 challenge 완료할 시간 (80포트 도달 필요)
sleep 15

# ---------- 6) 완료 callback (어떤 일이 있어도 보냄) ----------
DASHBOARD_URL="https://$DASHBOARD_DOMAIN"
DIAG=$(collect_diagnostics)
# DB 컬럼은 'password' 그대로 재사용 (의미는 PIN). owlim 의 status route 가 pin 으로 rename 해서 클라이언트에 반환.
report 6 "준비 완료" ",\"ip\":\"$PUBLIC_IP\",\"dashboard_url\":\"$DASHBOARD_URL\",\"password\":\"$DASHBOARD_PIN\",\"diagnostics\":$DIAG"

# 정상 종료 — trap이 종료 시 false alarm 안 보내도록
trap - ERR EXIT
exit 0
