/**
 * 单例 WebSocket 客户端：自动重连、重新鉴权、重新订阅
 *
 * 手机静置 / 切后台后，iOS 常把 TCP 连接悄悄掐断而 WebSocket 仍显示 OPEN（半开连接），
 * 这时发出去的消息全部石沉大海。所以：
 *  - 心跳：每 15s 发 ping；超过 35s 没收到任何服务端消息就主动 close → 触发重连
 *  - 回到前台 / 网络恢复 / 页面重新可见：立刻检查，超过 10s 没消息就直接重连
 *  - 重连后自动重新 auth + 重新 subscribe，服务端会推全量 table:state（含本人注码）
 */
import { auth, deviceLabel } from './api';
import { syncClock } from './useCountdown';

type Listener = (msg: any) => void;

class GameSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private subs = new Set<string>();
  private queue: string[] = [];
  private retry = 0;
  private lastRecv = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeHooked = false;
  /** 连接状态变化（'open' | 'closed'），页面可用来提示"重连中" */
  onStatus: ((s: 'open' | 'closed') => void) | null = null;

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.hookWake();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastRecv = Date.now();
      if (auth.token) ws.send(JSON.stringify({ type: 'auth', token: auth.token, device: deviceLabel }));
      for (const id of this.subs) ws.send(JSON.stringify({ type: 'subscribe', tableId: id }));
      for (const m of this.queue.splice(0)) ws.send(m);
      this.startHeartbeat();
      this.onStatus?.('open');
    };
    ws.onmessage = (ev) => {
      this.lastRecv = Date.now();
      const msg = JSON.parse(ev.data);
      if (msg?.type === 'pong') return;
      if (msg?.type === 'table:state' && msg.table?.serverTime) syncClock(msg.table.serverTime);
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.stopHeartbeat();
      this.onStatus?.('closed');
      this.scheduleReconnect(Math.min(10000, 500 * 2 ** this.retry++));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  private scheduleReconnect(ms: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, ms);
  }

  /** 强制断开并立即重连（半开连接、切回前台时用） */
  reconnect() {
    this.retry = 0;
    const old = this.ws; this.ws = null;
    this.stopHeartbeat();
    if (old) { old.onclose = null; try { old.close(); } catch { /* ignore */ } }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.connect();
  }

  /** 回到前台 / 网络恢复：连接不健康就重连 */
  wake(maxSilenceMs = 10_000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.reconnect(); return; }
    if (Date.now() - this.lastRecv > maxSilenceMs) { this.reconnect(); return; }
    this.send({ type: 'ping' });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastRecv > 35_000) { this.reconnect(); return; }   // 服务端 35s 没任何消息：判定已死
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }, 15_000);
  }
  private stopHeartbeat() { if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; } }

  private hookWake() {
    if (this.wakeHooked || typeof window === 'undefined') return;
    this.wakeHooked = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.wake(); });
    window.addEventListener('pageshow', () => this.wake());
    window.addEventListener('focus', () => this.wake());
    window.addEventListener('online', () => this.reconnect());
    window.addEventListener('native:lifecycle', (e) => { if ((e as CustomEvent).detail === 'resumed') this.wake(3000); });
  }

  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  send(msg: unknown) {
    const s = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else { this.queue.push(s); this.connect(); }
  }

  subscribe(tableId: string) { this.subs.add(tableId); this.send({ type: 'subscribe', tableId }); }
  unsubscribe(tableId: string) { this.subs.delete(tableId); this.send({ type: 'unsubscribe', tableId }); }
  reauth() { if (auth.token) this.send({ type: 'auth', token: auth.token, device: deviceLabel }); }

  on(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
}

export const socket = new GameSocket();
if (typeof window !== 'undefined') (window as any).__ws = socket;   // 调试用
