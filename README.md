# Telegram Trading Server

텔레그램에서 자연어로 한국투자증권(KIS) 매매를 처리하는 봇 서버.

```
유저 → Telegram → 이 서버 → Claude API + KIS Trading MCP → KIS Open API
                       ↓
                  TP/SL 폴링 워커
```

- **자가 설치형 (self-hosted)**: 각자 자기 KIS 키로 자기 머신/VPS에서 운영
- **단일 프로세스**: Node 서버 + KIS Trading MCP 사이드카(Docker)
- **모의/실전 분리**: `MODE=paper|real`
- **국내·해외 주식 모두 지원**: KRX / NASDAQ / NYSE / AMEX / TSE / HKEX / SSE / SZSE / HNX / HSX
- **MCP 활용**: 한국투자증권 공식 [Kis Trading MCP](https://github.com/koreainvestment/open-trading-api/tree/main/MCP/Kis%20Trading%20MCP) (166개 API)를 사이드카 컨테이너로 띄워 백엔드로 사용. KIS REST 클라이언트 직접 안 짬.

## 예시 흐름

텔레그램에 보내기:

```
삼성전자 지금호가 3개 아래로 매수, TP 5% SL 3%, 시드 10%
```

봇 응답:

```
삼성전자(005930) 70,600원 × 14주 매수 (≈988,400원).
TP 74,130원 (+5%) / SL 68,482원 (-3%).
/confirm abc12345  또는  /cancel abc12345
```

`/confirm abc12345` 입력 시 주문 발사, 체결되면 TP/SL 자동 감시 시작.

---

## 요구사항

- Docker, Docker Compose
- Telegram Bot Token ([@BotFather](https://t.me/BotFather)에서 발급)
- 본인 Telegram chat_id ([@userinfobot](https://t.me/userinfobot)으로 확인)
- Anthropic API Key
- KIS Open API 발급된 App Key / Secret / 계좌번호 ([한국투자증권 개발자센터](https://apiportal.koreainvestment.com/))

> 실전 거래 전 반드시 **모의투자(paper)** 환경에서 검증할 것.

---

## 설치 (고객 가이드)

### 1) 서버 초기 셋업 (최초 1회, Vultr 등)

```bash
ssh root@<your-vultr-ip>

# Docker 설치 (Ubuntu)
curl -fsSL https://get.docker.com | sh

# 앱 디렉토리
mkdir -p /opt/telegram-trading && cd /opt/telegram-trading
git clone <이 repo URL> .

# KIS Trading MCP 업스트림 가져오기 (submodule 권장)
git submodule add https://github.com/koreainvestment/open-trading-api.git external/open-trading-api
git submodule update --init --recursive

# 환경 변수
cp .env.example .env
nano .env   # 값 채우기 (아래 항목 참고)
```

> `external/open-trading-api`는 한국투자증권 공식 [open-trading-api](https://github.com/koreainvestment/open-trading-api) repo. Kis Trading MCP 소스가 들어있고, 우리가 빌드 시 `infra/kis-mcp.Dockerfile`로 wrap해서 fastmcp 호환 패치를 한 줄 적용 후 컨테이너로 띄움.

### 2) `.env` 채우기

```ini
TELEGRAM_BOT_TOKEN=123456:abc...
ALLOWED_CHAT_IDS=12345678                # 본인 chat_id (콤마 구분 다중 가능)
ANTHROPIC_API_KEY=sk-ant-...

KIS_MCP_URL=http://kis-mcp:3000/sse      # docker-compose 안에서는 그대로
KIS_APP_KEY=...
KIS_APP_SECRET=...
KIS_ACCOUNT_NO=12345678-01               # 종합계좌-상품번호
MODE=paper                                # 검증 끝나기 전까지 paper 유지

MAX_TRADE_KRW=1000000
MAX_OPEN_POSITIONS=5
COOLDOWN_SEC=300
DAILY_LOSS_KRW=300000
INTENT_TTL_MIN=5
```

### 3) 첫 실행

```bash
docker compose up -d
docker compose logs -f bot
```

봇이 `[bot] started as @your_bot_name` 메시지를 띄우면 OK.

텔레그램에서 봇과 대화 시작 → `/help`.

---

## 명령어

| 명령 | 설명 |
|---|---|
| 자유 텍스트 | LLM이 해석 → 매매 제안 또는 정보 응답 |
| `/help` | 명령어 안내 |
| `/balance` | 잔고/평가 |
| `/positions` | 보유/대기 포지션 |
| `/confirm <id>` | 제안된 주문 실행 |
| `/cancel <id>` | 제안된 주문 취소 |
| `/close <position_id>` | 보유 포지션 시장가 청산 |

---

## 자동 배포 (GitHub Actions)

`main` 브랜치 push 시 자동으로 Vultr에 배포되도록 셋업되어 있음.

### GitHub repo Secrets

| 키 | 설명 |
|---|---|
| `VULTR_HOST` | Vultr 서버 IP 또는 도메인 |
| `VULTR_USERNAME` | SSH 사용자 (보통 `root` 또는 `ubuntu`) |
| `VULTR_SSH_KEY` | 배포 전용 SSH private key (PEM 전체) |
| `VULTR_SSH_PORT` | (선택) SSH 포트, 미설정 시 22 |
| `VULTR_APP_DIR` | (선택) 앱 디렉토리, 미설정 시 `/opt/telegram-trading` |

### 배포용 SSH 키 발급

로컬에서:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tt_deploy -C "tt-deploy"
# 공개키를 Vultr 서버 authorized_keys에 추가
cat ~/.ssh/tt_deploy.pub | ssh root@<vultr-ip> "cat >> ~/.ssh/authorized_keys"
# 비공개키 (~/.ssh/tt_deploy) 내용을 VULTR_SSH_KEY 시크릿에 통째로 붙여넣기
```

### Vultr 서버에서 git clone 한 후

```bash
cd /opt/telegram-trading
git remote -v   # origin이 잘 설정되어 있어야 함 (https 또는 ssh)
```

push 후 GitHub Actions 탭에서 진행 확인.

---

## 운영 메모

- **로그**: `docker compose logs -f bot`
- **DB**: SQLite, `data/tt.db`. 컨테이너 재시작해도 유지.
- **유량 제한**: KIS REST 모의 1건/초 / 실전 18건/초. 모니터는 30초 간격 폴링.
- **장 외 시간**: SL 임계 돌파해도 청산 주문이 거절될 수 있음. v1은 단순히 다음 폴링 때 재시도.
- **WS 실시간**: v1은 폴링 기반. WS 업그레이드는 v2.
- **호가 단위**: LLM이 시스템 프롬프트의 표 + 도구로 받은 호가 간격으로 라운딩.

## 안전장치

- whitelist된 `chat_id`만 봇 사용 가능
- LLM은 read-only MCP 도구만 호출 가능 (주문은 코드 게이트만 발사)
- `/confirm` 없이는 주문 발사 안 됨
- `MAX_TRADE_KRW` / `MAX_OPEN_POSITIONS` / 블랙리스트 / 쿨다운 / 일일 손실 한도 강제

## 알려진 제약

- 단일 사용자 가정 (multi-tenant 미지원)
- 매도 명령은 `/close`만. 자연어 매도 제안의 /confirm 흐름은 v2.
- 다중 종목 한 메시지는 미지원 (단일 종목 강제)
- TP/SL는 폴링 30초 (가격 급변 시 슬리피지 큼)
- 해외주식 시장가 주문은 거래소별 정책이 달라 v1은 지정가 위주. `/close` 시 진입 평균가로 매도 시도.
- KIS Trading MCP 업스트림이 fastmcp 2.x API 변경을 미반영. `infra/kis-mcp.Dockerfile`에서 `stateless_http` kwarg 제거 sed 패치 적용 (업스트림 수정 시 제거 가능)

## 라이선스

Private. 본인 사용 목적.
