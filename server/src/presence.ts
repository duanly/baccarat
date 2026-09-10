/**
 * 在线状态 / 登录会话追踪
 * WebSocket 鉴权成功 → 开一条 session；连接断开 → 结束并把时长累加到 users.total_online_ms。
 * 每隔一段时间刷新 last_seen_at，进程崩溃时也能大致保留在线时长。
 */
import type { DB } from './db/index.js';

interface Live { sessionId: number; userId: number; ip: string; device: string; startedAt: number }

export class Presence {
  private live = new Map<object, Live>();       // key: ws 连接对象
  private timer: NodeJS.Timeout;

  constructor(private db: DB) {
    this.timer = setInterval(() => this.heartbeat(), 30_000);
    this.timer.unref();
  }

  connect(key: object, userId: number, ip: string, device: string, userAgent: string) {
    this.disconnect(key);
    const now = Date.now();
    const r = this.db
      .prepare('INSERT INTO sessions (user_id, ip, device, user_agent, started_at, last_seen_at) VALUES (?,?,?,?,?,?)')
      .run(userId, ip, device, userAgent, now, now);
    this.db.prepare('UPDATE users SET last_ip = ?, last_device = COALESCE(NULLIF(?, \'\'), last_device) WHERE id = ?').run(ip, device, userId);
    this.live.set(key, { sessionId: Number(r.lastInsertRowid), userId, ip, device, startedAt: now });
  }

  disconnect(key: object) {
    const s = this.live.get(key);
    if (!s) return;
    this.live.delete(key);
    const now = Date.now();
    this.db.prepare('UPDATE sessions SET ended_at = ?, last_seen_at = ? WHERE id = ?').run(now, now, s.sessionId);
    this.db.prepare('UPDATE users SET total_online_ms = total_online_ms + ? WHERE id = ?').run(now - s.startedAt, s.userId);
  }

  private heartbeat() {
    const now = Date.now();
    const stmt = this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?');
    for (const s of this.live.values()) stmt.run(now, s.sessionId);
  }

  isOnline(userId: number): boolean {
    for (const s of this.live.values()) if (s.userId === userId) return true;
    return false;
  }

  onlineIds(): Set<number> {
    return new Set([...this.live.values()].map((s) => s.userId));
  }

  /** 当前在线会话的实时在线时长（未落库部分） */
  liveMs(userId: number): number {
    let ms = 0;
    for (const s of this.live.values()) if (s.userId === userId) ms += Date.now() - s.startedAt;
    return ms;
  }

  current(userId: number): Live | undefined {
    for (const s of this.live.values()) if (s.userId === userId) return s;
    return undefined;
  }
}

/** 从 UA 粗略识别设备型号（App 内由桥上报更准确，通过 X-Device 头/WS auth 消息传入） */
export function deviceFromUa(ua = ''): string {
  if (/BaccaratApp/.test(ua)) return /iPhone|iPad/.test(ua) ? 'iOS App' : 'Android App';
  const m = /\(([^)]+)\)/.exec(ua);
  if (!m) return 'Unknown';
  const inner = m[1];
  if (/iPhone/.test(inner)) return 'iPhone ' + (/OS (\d+_\d+)/.exec(inner)?.[1].replace('_', '.') ?? '');
  if (/iPad/.test(inner)) return 'iPad';
  const android = /Android [\d.]+; ([^;)]+)/.exec(inner);
  if (android) return android[1].replace(/ Build.*/, '').trim();
  if (/Macintosh/.test(inner)) return 'Mac';
  if (/Windows/.test(inner)) return 'Windows PC';
  if (/Linux/.test(inner)) return 'Linux PC';
  return inner.split(';')[0].trim();
}

export function clientIp(headers: Record<string, unknown>, remote?: string): string {
  const xf = headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : String(xf ?? '')).split(',')[0].trim();
  const ip = first || remote || '';
  return ip.replace(/^::ffff:/, '');
}
