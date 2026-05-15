# OWLIM STOCK PWA

봇 서버(Hono)의 정적 SPA. Vue 3 + Vite + Tailwind.

## 로컬 개발

두 터미널 (또는 한 명령으로):

```bash
# 터미널 1 (봇 + API 서버)
pnpm dev:bot          # localhost:8080

# 터미널 2 (PWA dev server, hot reload)
pnpm dev:web          # localhost:5173 — /api/* 는 8080으로 자동 proxy

# 또는 한 번에:
pnpm dev:all
```

브라우저: http://localhost:5173

## 빌드

```bash
pnpm build:all        # 봇 dist/ + web dist/web/
# 또는 web만:
pnpm build:web
```

배포는 Dockerfile이 자동 처리 (PR5에서 multi-stage 추가).

## 폴더 구조

```
web/
├── src/
│   ├── main.ts           Vue 진입
│   ├── App.vue           최상위 (Header + RouterView + BottomNav)
│   ├── router.ts         경로 정의
│   ├── api/client.ts     봇 REST 래퍼
│   ├── lib/
│   │   ├── format.ts     포맷 유틸 (KRW/Pct/시간)
│   │   └── utils.ts      cn() helper (tailwind-merge)
│   ├── components/
│   │   ├── ui/           Button, Card 등 (shadcn 스타일)
│   │   └── layout/       AppHeader, BottomNav
│   ├── pages/            라우트별 페이지
│   └── styles/main.css   Tailwind + CSS 변수
└── public/
```

## 주의

- 텔레그램 봇과 PWA가 같은 .env 사용 — `KIS_PAPER_*` 키 입력돼 있어야 KIS 호출 가능
- KIS 토큰 발급 1분당 1회 제한 — 첫 호출 후 잠시 기다려야 함
- 로컬 봇과 production 봇이 같은 TELEGRAM_BOT_TOKEN이면 텔레그램 메시지 충돌. 로컬에선 토큰 변경 또는 ALLOWED_CHAT_IDS만 본인 ID
