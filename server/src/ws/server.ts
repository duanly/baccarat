/**
 * WebSocket 实时协议
 *
 * 客户端 → 服务端：
 *   { type: 'auth', token, device? }        device: App 桥上报的设备型号
 *   { type: 'subscribe', tableId }      进入牌桌（一个连接可订阅多桌，如大厅缩略图）
 *   { type: 'unsubscribe', tableId }
 *   { type: 'bet', tableId, bets: { banker: 100, playerPair: 20 } }
 *   { type: 'clearBets', tableId }
 *   { type: 'clearBet', tableId, betType }             撤回某个投注区
 *   { type: 'ping' }
 *
 * 服务端 → 客户端：
 *   { type: 'welcome', user }
 *   { type: 'table:state', table }                      全量快照（订阅时 / 阶段切换）
 *   { type: 'table:card', tableId, side, card, ... }    逐张发牌
 *   { type: 'table:result', tableId, result, roadmap }  开奖 + 最新牌路
 *   { type: 'table:bets', tableId, leaderboard }        各玩家押注/输赢面板（已排序）
 *   { type: 'bet:ok', tableId, bets, balance }
 *   { type: 'settled', tableId, settlements, balance }  本人结算
 *   { type: 'error', message }
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { AuthService, User } from '../auth.js';
import type { TableManager } from '../game/manager.js';
import type { BaccaratTable } from '../game/table.js';
import { clientIp, deviceFromUa, type Presence } from '../presence.js';

interface Client {
  ws: WebSocket;
  user: User | null;
  subs: Set<string>;
  ip: string;
  ua: string;
}

export function attachWs(server: Server, auth: AuthService, tables: TableManager, presence: Presence, rooms?: import('../rooms.js').RoomService) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<Client>();
  const send = (ws: WebSocket, msg: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

  // 牌桌事件 → 广播给订阅者
  for (const t of tables.tables.values()) wire(t);
  tables.onAdd(wire);   // 运行中创建的私人房间也要挂上广播

  function wire(t: BaccaratTable) {
    const id = t.cfg.id;
    const broadcast = (msg: unknown) => {
      const s = JSON.stringify(msg);
      for (const c of clients) if (c.subs.has(id) && c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
    };
    t.on('state', (table) => broadcast({ type: 'table:state', table }));
    t.on('card', (e) => broadcast({ type: 'table:card', ...e }));
    t.on('result', (e) => broadcast({ type: 'table:result', ...e }));
    t.on('bets', (e) => broadcast({ type: 'table:bets', ...e }));
    t.on('settled', (e) => {
      for (const c of clients) if (c.user?.id === e.userId) send(c.ws, { type: 'settled', ...e });
    });
  }

  wss.on('connection', (ws, req) => {
    const client: Client = {
      ws, user: null, subs: new Set(),
      ip: clientIp(req.headers as any, req.socket.remoteAddress),
      ua: String(req.headers['user-agent'] ?? ''),
    };
    clients.add(client);

    ws.on('message', (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return send(ws, { type: 'error', message: 'bad json' }); }
      try {
        handle(client, msg);
      } catch (e: any) {
        send(ws, { type: 'error', message: e.message, tableId: msg.tableId });
      }
    });

    ws.on('close', () => {
      for (const id of client.subs) if (client.user) tables.get(id).leave(client.user.id);
      presence.disconnect(client);
      clients.delete(client);
    });
  });

  function handle(c: Client, msg: any) {
    switch (msg.type) {
      case 'auth': {
        const user = auth.authenticate(msg.token);
        if (!user) throw new Error('invalid token');
        if (user.status === 'frozen') throw new Error('账号已冻结');
        c.user = user;
        // msg.device：App 桥上报的 "iPhone15,2 iOS 17.4 v1.0.0"；网页则从 UA 推断
        presence.connect(c, user.id, c.ip, String(msg.device ?? '') || deviceFromUa(c.ua), c.ua);
        return send(c.ws, { type: 'welcome', user });
      }
      case 'ping':
        return send(c.ws, { type: 'pong', t: Date.now() });
      case 'subscribe': {
        const t = tables.get(msg.tableId);
        const hall = tables.hallOf(t.cfg.id);
        if (hall && (c.user?.vipLevel ?? 0) < hall.minVipLevel) throw new Error(`需要 VIP${hall.minVipLevel} 等级`);
        if (t.cfg.hallId === 'private' && rooms && c.user) rooms.assertCanEnter(t.cfg.id, c.user.id);
        if (c.user) {
          try { t.join(c.user.id, c.user.nickname); }
          catch (e: any) { if (e.message === 'FULL') throw new Error(`满房：该桌已有 ${t.cfg.capacity} 人`); throw e; }
        }
        c.subs.add(t.cfg.id);
        return send(c.ws, { type: 'table:state', table: t.snapshot(), myBets: c.user ? t.getBets(c.user.id) : {} });
      }
      case 'unsubscribe': {
        c.subs.delete(msg.tableId);
        if (c.user) tables.get(msg.tableId).leave(c.user.id);
        return;
      }
      case 'bet': {
        if (!c.user) throw new Error('未登录');
        const t = tables.get(msg.tableId);
        const r = t.placeBets(c.user.id, c.user.nickname, msg.bets ?? {});
        return send(c.ws, { type: 'bet:ok', tableId: t.cfg.id, ...r });
      }
      case 'clearBet': {
        if (!c.user) throw new Error('未登录');
        const t = tables.get(msg.tableId);
        const r = t.clearBet(c.user.id, msg.betType);
        return send(c.ws, { type: 'bet:ok', tableId: t.cfg.id, bets: r.bets, balance: r.balance });
      }
      case 'clearBets': {
        if (!c.user) throw new Error('未登录');
        const t = tables.get(msg.tableId);
        return send(c.ws, { type: 'bet:ok', tableId: t.cfg.id, bets: {}, balance: t.clearBets(c.user.id) });
      }
      default:
        throw new Error(`unknown message type ${msg.type}`);
    }
  }

  return wss;
}
