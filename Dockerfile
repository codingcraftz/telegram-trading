FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* .npmrc* ./
RUN pnpm install --frozen-lockfile || pnpm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
# 빌드 시 GitHub Actions가 GIT_SHA / BUILD_DATE inject → 대시보드 버전 표시용
ARG GIT_SHA=dev
ARG BUILD_DATE=
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_DATE=${BUILD_DATE}
# 한글 차트 렌더링용 폰트 (sharp가 SVG → PNG 변환 시 시스템 폰트 사용)
RUN apt-get update && apt-get install -y --no-install-recommends \
      fontconfig fonts-nanum fonts-nanum-coding \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv >/dev/null 2>&1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/data
VOLUME ["/app/data"]
CMD ["node", "dist/main.js"]
