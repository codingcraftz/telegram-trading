# Upstream KIS Trading MCP wrapper.
# 1. 업스트림 (https://github.com/koreainvestment/open-trading-api) 의 Kis Trading MCP 폴더 그대로 사용
# 2. fastmcp 2.x API 변경 (stateless_http kwarg 제거) 우회 패치
# 3. 의존성 설치 후 server.py 실행 (SSE on :3000)
#
# 빌드 시 context는 telegram-trading 루트.

FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

# 업스트림 MCP 소스 (telegram-trading/external/open-trading-api/MCP/Kis Trading MCP)
COPY ["external/open-trading-api/MCP/Kis Trading MCP/", "/app/"]

# 패치: fastmcp 2.x 호환을 위해 server.py의 stateless_http 인자 제거
RUN sed -i 's/[[:space:]]*stateless_http=False,//g' server.py \
    && echo "--- patched server.py around FastMCP() ---" \
    && sed -n '40,55p' server.py

# 패치: tools/base.py의 trenv 자동 주입 시 UPPERCASE 키 추가 버그 제거.
# 'CANO' 같은 대문자 키가 파이썬 함수에 unexpected kwarg로 전달되어 TypeError 발생.
RUN sed -i '/dynamic_mappings\[param_name\.upper()\]/d' tools/base.py \
    && echo "--- patched base.py trenv upper bug ---"

# 의존성 설치
RUN if [ -f uv.lock ]; then uv sync --frozen; else uv sync; fi

ENV ENV=live \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1

EXPOSE 3000

CMD ["uv", "run", "python", "server.py"]
