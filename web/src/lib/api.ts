import type { RoomInfo, RoomMember, Bets, Hall, TableSnapshot, User } from './protocol';
import { native } from './native';

/** token 内存缓存；持久化走 native 桥（App 内 Keychain/Keystore，浏览器里 localStorage） */
let cached: string | null = null;
export const auth = {
  get token(): string | null { return cached; },
  set token(v: string | null) { cached = v; void native.setToken(v); },
  /** 启动时调用一次，从持久层恢复 */
  async restore() { cached = await native.getToken(); return cached; },
};

/** 设备描述（App 内由原生桥提供，网页留空由服务端从 UA 推断） */
export let deviceLabel = '';
native.getDeviceInfo().then((d) => { if (d) deviceLabel = `${d.model} ${d.osVersion} v${d.appVersion}`; }).catch(() => {});

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
      ...(deviceLabel ? { 'x-device': deviceLabel } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const api = {
  register: (username: string, password: string, nickname?: string) =>
    req<{ user: User; token: string }>('POST', '/auth/register', { username, password, nickname }),
  login: (username: string, password: string) => req<{ user: User; token: string }>('POST', '/auth/login', { username, password }),
  me: () => req<{ user: User }>('GET', '/me'),
  deposit: (amount: number) => req<{ balance: number }>('POST', '/me/deposit', { amount }),
  halls: () => req<{ halls: Hall[] }>('GET', '/halls'),
  table: (id: string) => req<{ table: TableSnapshot; myBets: Bets; room?: RoomInfo | null }>('GET', `/tables/${id}`),
  // 私人房间
  myRooms: () => req<{ items: RoomInfo[] }>('GET', '/rooms/mine'),
  createRoom: (body: { name?: string; password: string; minBet?: number; maxBet?: number; maxSideBet?: number }) => req<RoomInfo>('POST', '/rooms', body),
  joinRoom: (password: string) => req<RoomInfo>('POST', '/rooms/join', { password }),
  room: (id: string) => req<RoomInfo>('GET', `/rooms/${id}`),
  roomMembers: (id: string) => req<{ items: RoomMember[] }>('GET', `/rooms/${id}/members`),
  updateRoom: (id: string, patch: Record<string, unknown>) => req<RoomInfo>('PATCH', `/rooms/${id}`, patch),
  roomTransfer: (id: string, userId: number, amount: number, note?: string) => req<{ ownerBalance: number; memberBalance: number }>('POST', `/rooms/${id}/transfer`, { userId, amount, note }),
  kickMember: (id: string, userId: number) => req('DELETE', `/rooms/${id}/members/${userId}`),
  closeRoom: (id: string) => req('DELETE', `/rooms/${id}`),
  roomLedgerUrl: (id: string) => `/api/rooms/${id}/ledger.csv?token=${encodeURIComponent(auth.token ?? '')}`,
  myBets: () => req<{ items: any[] }>('GET', '/me/bets'),
};

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const admin = {
  summary: () => req<any>('GET', '/admin/summary'),
  groups: () => req<{ items: any[] }>('GET', '/admin/groups'),
  createGroup: (name: string, note?: string) => req<{ id: number }>('POST', '/admin/groups', { name, note }),
  deleteGroup: (id: number) => req('DELETE', `/admin/groups/${id}`),
  players: (params: Record<string, unknown>) => req<{ total: number; page: number; size: number; items: any[] }>('GET', `/admin/players${qs(params)}`),
  player: (id: number) => req<any>('GET', `/admin/players/${id}`),
  updatePlayer: (id: number, patch: Record<string, unknown>) => req<any>('PATCH', `/admin/players/${id}`, patch),
  adjust: (id: number, amount: number, note: string) => req<{ balance: number }>('POST', `/admin/players/${id}/adjust`, { amount, note }),
  transactions: (id: number, kind?: string) => req<{ items: any[] }>('GET', `/admin/players/${id}/transactions${qs({ kind })}`),
  bets: (id: number) => req<{ items: any[] }>('GET', `/admin/players/${id}/bets`),
  sessions: (id: number) => req<{ items: any[] }>('GET', `/admin/players/${id}/sessions`),
  tables: () => req<{ halls: any[]; items: any[] }>('GET', '/admin/tables'),
  updateTable: (id: string, patch: Record<string, number | undefined>) => req<any>('PATCH', `/admin/tables/${id}`, patch),
  applyHall: (from: string, hallId: string) => req<{ updated: number }>('POST', '/admin/tables/apply-hall', { from, hallId }),
  rooms: () => req<{ active: number; total: number; items: any[] }>('GET', '/admin/rooms'),
  roomMembers: (id: string) => req<{ items: RoomMember[] }>('GET', `/admin/rooms/${id}/members`),
};
