/** 单例 WebSocket 客户端：自动重连、重新鉴权、重新订阅 */
import { auth, deviceLabel } from './api';

type Listener = (msg: any) => void;

class GameSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private subs = new Set<string>();
  private queue: string[] = [];
  private retry = 0;

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (auth.token) ws.send(JSON.stringify({ type: 'auth', token: auth.token, device: deviceLabel }));
      for (const id of this.subs) ws.send(JSON.stringify({ type: 'subscribe', tableId: id }));
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** this.retry++));
    };
  }

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
