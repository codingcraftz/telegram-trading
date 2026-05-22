// KIS WebSocket 클라이언트 — 호가(H0STASP0) 실시간 푸시.
// approval_key 발급 + 단일 WS connection + tr_key별 refcount subscribe.

import WebSocket from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { envDv } from '../runtime.js';
import { getKisCredentials } from './config.js';

// 장외 시간 판별 — KST 08:20~15:40 밖이면 off-market.
// WS 연결/재연결 시 불필요한 시도 방지.
function isOffMarketHours(): boolean {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const h = kst.getUTCHours();
  const m = kst.getUTCMinutes();
  const t = h * 60 + m;
  return t < 8 * 60 + 20 || t > 15 * 60 + 40;
}

type Mode = 'real' | 'demo';
const WS_URL: Record<Mode, string> = {
  real: 'ws://ops.koreainvestment.com:21000',
  demo: 'ws://ops.koreainvestment.com:31000',
};
const APPROVAL_URL: Record<Mode, string> = {
  real: 'https://openapi.koreainvestment.com:9443/oauth2/Approval',
  demo: 'https://openapivts.koreainvestment.com:29443/oauth2/Approval',
};

export type AskingSnapshot = {
  code: string;
  asks: { price: number; qty: number }[];
  bids: { price: number; qty: number }[];
  totalAskQty: number;
  totalBidQty: number;
};
export type TickSnapshot = {
  code: string;
  price: number;       // 체결가
  change: number;      // 전일대비 (등락폭)
  changePct: number;   // 등락률
  volume: number;      // 체결량 (이번 체결)
  cumVolume: number;   // 누적 거래량
  ts: number;          // ms (서버 수신 시점)
};

type AskingListener = (snap: AskingSnapshot) => void;
type TickListener = (snap: TickSnapshot) => void;

function approvalFilePath(mode: Mode): string {
  const base = process.env.TOKEN_CACHE_DIR ?? resolve(process.cwd(), 'data');
  return resolve(base, `.kis-approval-${mode}.json`);
}
function loadApprovalFromDisk(mode: Mode): { key: string; at: number } | null {
  const path = approvalFilePath(mode);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { key: string; at: number };
    // 12시간 이내면 재사용
    if (parsed.key && Date.now() - parsed.at < 12 * 3600 * 1000) return parsed;
  } catch { /* ignore */ }
  return null;
}
function saveApprovalToDisk(mode: Mode, key: string, at: number) {
  const path = approvalFilePath(mode);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ key, at }), { mode: 0o600 });
  } catch (err) {
    console.warn('[kis-ws] approval 디스크 캐시 저장 실패:', (err as Error).message);
  }
}

let approvalKey: string | null = null;
let approvalAt = 0;

async function getApprovalKey(mode: Mode = envDv()): Promise<string> {
  if (approvalKey && Date.now() - approvalAt < 12 * 3600 * 1000) return approvalKey;
  const disk = loadApprovalFromDisk(mode);
  if (disk) {
    approvalKey = disk.key;
    approvalAt = disk.at;
    return disk.key;
  }
  const { appKey, appSecret } = getKisCredentials(mode);
  if (!appKey || !appSecret) throw new Error(`KIS ${mode} 키 미입력`);
  const res = await fetch(APPROVAL_URL[mode], {
    method: 'POST',
    headers: { 'content-type': 'application/json; utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      secretkey: appSecret,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`KIS approval_key 발급 실패 (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { approval_key: string };
  approvalKey = data.approval_key;
  approvalAt = Date.now();
  saveApprovalToDisk(mode, approvalKey, approvalAt);
  return approvalKey;
}

class KisWsClient {
  private ws: WebSocket | null = null;
  private mode: Mode = 'real';
  private connecting: Promise<void> | null = null;
  private askingListeners = new Map<string, Set<AskingListener>>(); // H0STASP0
  private tickListeners = new Map<string, Set<TickListener>>(); // H0STCNT0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  setMode(mode: Mode) {
    if (this.mode !== mode) {
      this.mode = mode;
      this.close();
    }
  }

  private async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await getApprovalKey(this.mode); // 사이드 이펙트: 캐시 보장
      const url = WS_URL[this.mode];
      const ws = new WebSocket(url);
      this.ws = ws;
      await new Promise<void>((resolve, reject) => {
        const onOpen = () => { cleanup(); resolve(); };
        const onError = (err: unknown) => { cleanup(); reject(err); };
        function cleanup() {
          ws.off('open', onOpen);
          ws.off('error', onError);
        }
        ws.on('open', onOpen);
        ws.on('error', onError);
      });
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('close', () => this.onClose());
      ws.on('error', (err) => console.warn('[kis-ws] error:', (err as Error).message));
      // 기존 구독자 재등록
      for (const tr_key of this.askingListeners.keys()) {
        await this.sendSubscribe('H0STASP0', tr_key);
      }
      for (const tr_key of this.tickListeners.keys()) {
        await this.sendSubscribe('H0STCNT0', tr_key);
      }
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private reconnectAttempt = 0;
  private static readonly MAX_RECONNECT_DELAY = 60_000;

  private onClose() {
    this.ws = null;
    if (this.askingListeners.size > 0 || this.tickListeners.size > 0) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      // 장외 시간이면 reconnect 안 함
      if (isOffMarketHours()) {
        console.log('[kis-ws] off-market hours — skip reconnect');
        return;
      }
      // exponential backoff: 3s, 6s, 12s, ... max 60s
      const delay = Math.min(3_000 * Math.pow(2, this.reconnectAttempt), KisWsClient.MAX_RECONNECT_DELAY);
      this.reconnectAttempt++;
      console.log(`[kis-ws] reconnect in ${delay / 1000}s (attempt ${this.reconnectAttempt})`);
      this.reconnectTimer = setTimeout(() => {
        this.connect()
          .then(() => { this.reconnectAttempt = 0; }) // 성공 시 리셋
          .catch((err) => console.warn('[kis-ws] reconnect fail:', err.message));
      }, delay);
    }
  }

  close() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private async sendSubscribe(tr_id: string, tr_key: string) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const key = await getApprovalKey(this.mode);
    const msg = {
      header: { approval_key: key, custtype: 'P', tr_type: '1', 'content-type': 'utf-8' },
      body: { input: { tr_id, tr_key } },
    };
    ws.send(JSON.stringify(msg));
  }

  private async sendUnsubscribe(tr_id: string, tr_key: string) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const key = await getApprovalKey(this.mode);
    const msg = {
      header: { approval_key: key, custtype: 'P', tr_type: '2', 'content-type': 'utf-8' },
      body: { input: { tr_id, tr_key } },
    };
    ws.send(JSON.stringify(msg));
  }

  async subscribeAsking(code: string, listener: AskingListener): Promise<() => void> {
    await this.connect();
    let set = this.askingListeners.get(code);
    if (!set) {
      set = new Set();
      this.askingListeners.set(code, set);
      await this.sendSubscribe('H0STASP0', code);
    }
    set.add(listener);
    return () => this.unsubAsking(code, listener);
  }

  private async unsubAsking(code: string, listener: AskingListener) {
    const set = this.askingListeners.get(code);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.askingListeners.delete(code);
      await this.sendUnsubscribe('H0STASP0', code);
      if (this.askingListeners.size === 0 && this.tickListeners.size === 0) this.close();
    }
  }

  async subscribeTick(code: string, listener: TickListener): Promise<() => void> {
    await this.connect();
    let set = this.tickListeners.get(code);
    if (!set) {
      set = new Set();
      this.tickListeners.set(code, set);
      await this.sendSubscribe('H0STCNT0', code);
    }
    set.add(listener);
    return () => this.unsubTick(code, listener);
  }

  private async unsubTick(code: string, listener: TickListener) {
    const set = this.tickListeners.get(code);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.tickListeners.delete(code);
      await this.sendUnsubscribe('H0STCNT0', code);
      if (this.askingListeners.size === 0 && this.tickListeners.size === 0) this.close();
    }
  }

  private onMessage(raw: string) {
    // JSON (subscribe ack, pingpong) vs pipe-delimited (실시간 데이터)
    if (raw.startsWith('{')) {
      // pingpong
      try {
        const obj = JSON.parse(raw) as { header?: { tr_id?: string }; body?: unknown };
        if (obj.header?.tr_id === 'PINGPONG') {
          this.ws?.send(raw); // echo
        }
      } catch { /* ignore */ }
      return;
    }
    // 실시간 데이터: 0|H0STASP0|001|005930^bsop_hour^...
    const parts = raw.split('|');
    if (parts.length < 4) return;
    const trId = parts[1];
    const payload = parts[3] ?? '';
    if (trId === 'H0STASP0') {
      const snap = parseAskingPayload(payload);
      if (snap) {
        const set = this.askingListeners.get(snap.code);
        if (set) for (const l of set) l(snap);
      }
    } else if (trId === 'H0STCNT0') {
      const snap = parseTickPayload(payload);
      if (snap) {
        const set = this.tickListeners.get(snap.code);
        if (set) for (const l of set) l(snap);
      }
    }
  }
}

// H0STASP0 payload 필드 순서 (KIS docs):
// 0: MKSC_SHRN_ISCD, 1: BSOP_HOUR, 2: HOUR_CLS_CODE,
// 3..12: ASKP1..10, 13..22: BIDP1..10,
// 23..32: ASKP_RSQN1..10, 33..42: BIDP_RSQN1..10,
// 43: TOTAL_ASKP_RSQN, 44: TOTAL_BIDP_RSQN,
function parseAskingPayload(payload: string): AskingSnapshot | null {
  const f = payload.split('^');
  if (f.length < 45) return null;
  const code = f[0]!;
  const asks: AskingSnapshot['asks'] = [];
  const bids: AskingSnapshot['bids'] = [];
  for (let i = 0; i < 10; i++) {
    const p = Number(f[3 + i]);
    const q = Number(f[23 + i]);
    if (p > 0) asks.push({ price: p, qty: q || 0 });
    const bp = Number(f[13 + i]);
    const bq = Number(f[33 + i]);
    if (bp > 0) bids.push({ price: bp, qty: bq || 0 });
  }
  return {
    code,
    asks,
    bids,
    totalAskQty: Number(f[43]) || asks.reduce((s, x) => s + x.qty, 0),
    totalBidQty: Number(f[44]) || bids.reduce((s, x) => s + x.qty, 0),
  };
}

// H0STCNT0 payload 필드 순서 (KIS docs):
// 0:MKSC_SHRN_ISCD, 1:STCK_CNTG_HOUR, 2:STCK_PRPR (현재가),
// 3:PRDY_VRSS_SIGN, 4:PRDY_VRSS (전일대비), 5:PRDY_CTRT (등락률),
// ... 12:CNTG_VOL (체결량), 13:ACML_VOL (누적거래량), ...
function parseTickPayload(payload: string): TickSnapshot | null {
  const f = payload.split('^');
  if (f.length < 14) return null;
  const code = f[0]!;
  const price = Number(f[2]) || 0;
  if (price <= 0) return null;
  const sign = f[3] ?? '3'; // 1:상한 2:상승 3:보합 4:하한 5:하락
  const absChange = Number(f[4]) || 0;
  const change = sign === '4' || sign === '5' ? -absChange : absChange;
  const absRate = Number(f[5]) || 0;
  const changePct = sign === '4' || sign === '5' ? -absRate : absRate;
  const volume = Number(f[12]) || 0;
  const cumVolume = Number(f[13]) || 0;
  return { code, price, change, changePct, volume, cumVolume, ts: Date.now() };
}

const _client = new KisWsClient();
export function getKisWsClient(): KisWsClient {
  // 시세는 항상 real 키 사용 — pickModeFor와 동일 정책
  _client.setMode('real');
  return _client;
}
