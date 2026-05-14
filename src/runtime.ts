// 런타임 모드 토글 (메모리 상태). 봇 재시작 시 .env 기본값으로 복귀.

import { getConfig } from './config.js';

type Mode = 'paper' | 'real';
let _runtimeMode: Mode | null = null;

export function getMode(): Mode {
  return _runtimeMode ?? getConfig().MODE;
}

export function setMode(m: Mode): void {
  _runtimeMode = m;
}

export function envDv(): 'real' | 'demo' {
  return getMode() === 'paper' ? 'demo' : 'real';
}
