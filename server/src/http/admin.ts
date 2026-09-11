/**
 * 玩家管理后台 API（role=admin）
 *
 *  GET  /api/admin/summary                     总览
 *  GET  /api/admin/groups                      组别列表  POST 新建  PATCH /:id 改名  DELETE /:id
 *  GET  /api/admin/players?q=&group=&online=&status=&sort=&page=&size=
 *  GET  /api/admin/players/:id                 详情 + 统计
 *  PATCH /api/admin/players/:id                改组别 / VIP 等级 / 冻结 / 昵称
 *  POST /api/admin/players/:id/adjust          上分(amount>0) / 下分(amount<0)，带备注
 *  GET  /api/admin/players/:id/transactions    上下分与流水日志（kind 过滤）
 *  GET  /api/admin/players/:id/bets            下注输赢日志
 *  GET  /api/admin/players/:id/sessions        登录会话（IP / 设备 / 时长）
 *  GET  /api/admin/tables                      牌桌参数列表   PATCH /:id 修改（下注时长 / 发牌间隔 / 派彩停顿 / 限红，下一局生效）
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DB } from '../db/index.js';
import { AuthService, HttpError } from '../auth.js';
import type { Wallet } from '../wallet.js';
import type { Presence } from '../presence.js';
import type { TableManager } from '../game/manager.js';
import type { BotService } from '../bots.js';
import type { RoomService } from '../rooms.js';

interface Deps { db: DB; auth: AuthService; wallet: Wallet; presence: Presence; tables: TableManager; rooms: RoomService; bots: BotService }

export function adminRouter(d: Deps): Router {
  const r = Router();

  r.use((req: Request, _res: Response, next: NextFunction) => {
    const user = d.auth.authenticate(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!user || user.role !== 'admin') return next(new HttpError(403, '需要管理员权限'));
    req.user = user;
    next();
  });

  // ---------- 总览 ----------
  r.get('/summary', (_req, res) => {
    const today = startOfDay();
    const row = d.db.prepare(`SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'player' AND is_bot = 0) AS players,
        (SELECT COUNT(*) FROM users WHERE role = 'player' AND is_bot = 0 AND created_at >= ?) AS newToday,
        (SELECT COALESCE(SUM(b.amount),0) FROM bets b JOIN users u ON u.id = b.user_id WHERE b.created_at >= ? AND u.is_bot = 0) AS wageredToday,
        (SELECT COALESCE(SUM(b.net),0) FROM bets b JOIN users u ON u.id = b.user_id WHERE b.created_at >= ? AND u.is_bot = 0) AS playerNetToday,
        (SELECT COALESCE(SUM(t.amount),0) FROM transactions t JOIN users u ON u.id = t.user_id WHERE t.kind='deposit' AND t.created_at >= ? AND u.is_bot = 0) AS depositToday,
        (SELECT COALESCE(-SUM(t.amount),0) FROM transactions t JOIN users u ON u.id = t.user_id WHERE t.kind='withdraw' AND t.created_at >= ? AND u.is_bot = 0) AS withdrawToday,
        (SELECT COALESCE(SUM(balance),0) FROM users WHERE role = 'player' AND is_bot = 0) AS totalBalance,
        (SELECT COUNT(*) FROM rooms WHERE status = 'active') AS roomsActive,
        (SELECT COALESCE(SUM(amount),0) FROM bets WHERE created_at >= ? AND table_id LIKE 'room-%') AS wageredPrivateToday`)
      .get(today, today, today, today, today, today) as any;
    const online = [...d.presence.onlineIds()].filter((id) => (d.db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any)?.role === 'player').length;
    res.json({ ...row, online });
  });

  // ---------- 托账号（机器人） ----------
  r.get('/bots', (_req, res) => res.json(d.bots.status()));
  r.patch('/bots', (req, res) => { d.bots.update(req.body ?? {}); res.json(d.bots.status()); });

  // ---------- 私人房间 ----------
  r.get('/rooms', (_req, res) => {
    const items = d.rooms.adminList();
    res.json({ active: items.filter((x) => x.status === 'active').length, total: items.length, items });
  });
  r.get('/rooms/:id/members', (req, res) => {
    const room = d.rooms.row(req.params.id);
    res.json({ items: d.rooms.members(req.params.id, room.owner_id) });
  });

  // ---------- 牌桌参数 ----------
  const tableRow = (t: import('../game/table.js').BaccaratTable) => ({
    id: t.cfg.id, name: t.cfg.name, kind: t.cfg.kind, hallId: t.cfg.hallId, phase: t.phase, roundNo: t.roundNo,
    online: t.snapshot().playersOnline,
    bettingSeconds: t.cfg.bettingSeconds, dealIntervalMs: t.cfg.dealIntervalMs, resultPauseSeconds: t.cfg.resultPauseSeconds,
    minBet: t.cfg.minBet, maxBet: t.cfg.maxBet, maxSideBet: t.cfg.maxSideBet,
  });
  r.get('/tables', (_req, res) => {
    res.json({ halls: d.tables.halls.map((h) => ({ id: h.id, name: h.name, kind: h.kind })), items: [...d.tables.tables.values()].map(tableRow) });
  });
  r.patch('/tables/:id', (req, res) => {
    const t = d.tables.tables.get(req.params.id);
    if (!t) throw new HttpError(404, '牌桌不存在');
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
    const patch = {
      bettingSeconds: num(req.body?.bettingSeconds), dealIntervalMs: num(req.body?.dealIntervalMs), resultPauseSeconds: num(req.body?.resultPauseSeconds),
      minBet: num(req.body?.minBet), maxBet: num(req.body?.maxBet), maxSideBet: num(req.body?.maxSideBet),
    };
    t.updateSettings(patch);
    d.db.prepare(`INSERT INTO table_settings (table_id, betting_seconds, deal_interval_ms, result_pause_seconds, min_bet, max_bet, max_side_bet, updated_at)
                  VALUES (?,?,?,?,?,?,?,?)
                  ON CONFLICT(table_id) DO UPDATE SET betting_seconds=excluded.betting_seconds, deal_interval_ms=excluded.deal_interval_ms,
                    result_pause_seconds=excluded.result_pause_seconds, min_bet=excluded.min_bet, max_bet=excluded.max_bet, max_side_bet=excluded.max_side_bet, updated_at=excluded.updated_at`)
      .run(t.cfg.id, t.cfg.bettingSeconds, t.cfg.dealIntervalMs, t.cfg.resultPauseSeconds, t.cfg.minBet, t.cfg.maxBet, t.cfg.maxSideBet, Date.now());
    res.json(tableRow(t));
  });
  // 一键应用到同厅所有桌
  r.post('/tables/apply-hall', (req, res) => {
    const hallId = String(req.body?.hallId ?? '');
    const src = d.tables.tables.get(String(req.body?.from ?? ''));
    if (!src) throw new HttpError(404, '源牌桌不存在');
    const patch = { bettingSeconds: src.cfg.bettingSeconds, dealIntervalMs: src.cfg.dealIntervalMs, resultPauseSeconds: src.cfg.resultPauseSeconds, minBet: src.cfg.minBet, maxBet: src.cfg.maxBet, maxSideBet: src.cfg.maxSideBet };
    const stmt = d.db.prepare(`INSERT OR REPLACE INTO table_settings (table_id, betting_seconds, deal_interval_ms, result_pause_seconds, min_bet, max_bet, max_side_bet, updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    let n = 0;
    for (const t of d.tables.tables.values()) {
      if (t.cfg.hallId !== hallId || t === src) continue;
      t.updateSettings(patch);
      stmt.run(t.cfg.id, t.cfg.bettingSeconds, t.cfg.dealIntervalMs, t.cfg.resultPauseSeconds, t.cfg.minBet, t.cfg.maxBet, t.cfg.maxSideBet, Date.now());
      n++;
    }
    res.json({ updated: n });
  });

  // ---------- 组别 ----------
  r.get('/groups', (_req, res) => {
    res.json({ items: d.db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS members FROM groups g ORDER BY g.id`).all() });
  });
  r.post('/groups', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new HttpError(400, '组名不能为空');
    try {
      const x = d.db.prepare('INSERT INTO groups (name, note, created_at) VALUES (?,?,?)').run(name, req.body?.note ?? null, Date.now());
      res.json({ id: Number(x.lastInsertRowid) });
    } catch (e: any) { throw new HttpError(409, '组名已存在'); }
  });
  r.patch('/groups/:id', (req, res) => {
    d.db.prepare('UPDATE groups SET name = COALESCE(?, name), note = COALESCE(?, note) WHERE id = ?').run(req.body?.name ?? null, req.body?.note ?? null, req.params.id);
    res.json({ ok: true });
  });
  r.delete('/groups/:id', (req, res) => {
    d.db.prepare('UPDATE users SET group_id = NULL WHERE group_id = ?').run(req.params.id);
    d.db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- 玩家列表 ----------
  const SORTS: Record<string, string> = {
    id: 'u.id', balance: 'u.balance', wagered: 'wagered', net: 'net', lastLogin: 'u.last_login_at', online: 'u.total_online_ms', bets: 'betCount',
  };
  r.get('/players', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const group = req.query.group ? Number(req.query.group) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const online = req.query.online === '1';
    const sort = SORTS[String(req.query.sort ?? '')] ?? 'u.id';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const size = Math.min(200, Math.max(1, Number(req.query.size ?? 50)));
    const page = Math.max(1, Number(req.query.page ?? 1));
    const onlineIds = d.presence.onlineIds();

    const where: string[] = ["u.role = 'player'"];
    const args: any[] = [];
    if (q) { where.push('(u.username LIKE ? OR u.nickname LIKE ? OR u.last_ip LIKE ? OR CAST(u.id AS TEXT) = ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, q); }
    if (group !== null) { if (group === 0) where.push('u.group_id IS NULL'); else { where.push('u.group_id = ?'); args.push(group); } }
    if (status) { where.push('u.status = ?'); args.push(status); }
    if (online) { where.push(onlineIds.size ? `u.id IN (${[...onlineIds].join(',')})` : '0'); }

    const base = `FROM users u
      LEFT JOIN (SELECT user_id, SUM(amount) AS wagered, SUM(net) AS net, COUNT(*) AS betCount, COUNT(DISTINCT round_id) AS rounds, MAX(created_at) AS lastBetAt,
                         SUM(CASE WHEN table_id LIKE 'room-%' THEN amount ELSE 0 END) AS wageredPrivate, SUM(CASE WHEN table_id LIKE 'room-%' THEN net ELSE 0 END) AS netPrivate FROM bets GROUP BY user_id) b ON b.user_id = u.id
      LEFT JOIN (SELECT user_id,
          SUM(CASE WHEN kind='deposit' THEN amount ELSE 0 END) AS deposits,
          SUM(CASE WHEN kind='withdraw' THEN -amount ELSE 0 END) AS withdraws FROM transactions GROUP BY user_id) t ON t.user_id = u.id
      LEFT JOIN groups g ON g.id = u.group_id
      WHERE ${where.join(' AND ')}`;
    const total = (d.db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...args) as any).n;
    const rows = d.db.prepare(`SELECT u.id, u.username, u.nickname, u.vip_level, u.balance, u.status, u.group_id, g.name AS group_name, u.can_host, u.max_rooms,
        u.last_login_at, u.last_ip, u.last_device, u.total_online_ms, u.created_at,
        COALESCE(b.wagered,0) AS wagered, COALESCE(b.net,0) AS net, COALESCE(b.betCount,0) AS betCount, COALESCE(b.rounds,0) AS rounds, b.lastBetAt,
        COALESCE(b.wageredPrivate,0) AS wageredPrivate, COALESCE(b.netPrivate,0) AS netPrivate,
        COALESCE(t.deposits,0) AS deposits, COALESCE(t.withdraws,0) AS withdraws
        ${base} ORDER BY ${sort} ${dir}, u.id DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size) as any[];
    res.json({ total, page, size, items: rows.map((x) => decorate(x, d.presence)) });
  });

  // ---------- 详情 ----------
  r.get('/players/:id', (req, res) => {
    const id = Number(req.params.id);
    const u = d.db.prepare(`SELECT u.*, g.name AS group_name FROM users u LEFT JOIN groups g ON g.id = u.group_id WHERE u.id = ?`).get(id) as any;
    if (!u) throw new HttpError(404, '玩家不存在');
    delete u.password_hash; delete u.salt;
    const b = d.db.prepare(`SELECT COALESCE(SUM(amount),0) AS wagered, COALESCE(SUM(net),0) AS net, COUNT(*) AS betCount, COUNT(DISTINCT round_id) AS rounds,
        MAX(created_at) AS lastBetAt, MIN(created_at) AS firstBetAt, COALESCE(MAX(amount),0) AS maxBet,
        COALESCE(SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END),0) AS wins FROM bets WHERE user_id = ?`).get(id) as any;
    const t = d.db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN kind='deposit' THEN amount END),0) AS deposits,
        COALESCE(SUM(CASE WHEN kind='withdraw' THEN -amount END),0) AS withdraws,
        COALESCE(SUM(CASE WHEN kind='deposit' THEN 1 END),0) AS depositCount,
        COALESCE(SUM(CASE WHEN kind='withdraw' THEN 1 END),0) AS withdrawCount FROM transactions WHERE user_id = ?`).get(id) as any;
    const byType = d.db.prepare(`SELECT bet_type, COUNT(*) AS n, SUM(amount) AS wagered, SUM(net) AS net FROM bets WHERE user_id = ? GROUP BY bet_type ORDER BY wagered DESC`).all(id);
    // 正常房 / 私人房分开统计
    const split = d.db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN table_id LIKE 'room-%' THEN amount ELSE 0 END),0) AS wageredPrivate, COALESCE(SUM(CASE WHEN table_id LIKE 'room-%' THEN net ELSE 0 END),0) AS netPrivate,
        COALESCE(SUM(CASE WHEN table_id LIKE 'room-%' THEN 1 ELSE 0 END),0) AS betsPrivate, COUNT(DISTINCT CASE WHEN table_id LIKE 'room-%' THEN round_id END) AS roundsPrivate,
        COALESCE(SUM(CASE WHEN table_id NOT LIKE 'room-%' THEN amount ELSE 0 END),0) AS wageredPublic, COALESCE(SUM(CASE WHEN table_id NOT LIKE 'room-%' THEN net ELSE 0 END),0) AS netPublic,
        COALESCE(SUM(CASE WHEN table_id NOT LIKE 'room-%' THEN 1 ELSE 0 END),0) AS betsPublic, COUNT(DISTINCT CASE WHEN table_id NOT LIKE 'room-%' THEN round_id END) AS roundsPublic
        FROM bets WHERE user_id = ?`).get(id) as any;
    // 私人房上下分（房主 ↔ 成员的转账）：作为成员收到 / 被收回；作为房主发出 / 收回（按 ref 前缀 room- 与 operator 区分）
    const roomTransfers = d.db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN operator_id <> user_id AND amount > 0 THEN amount ELSE 0 END),0) AS inAmt,
        COALESCE(SUM(CASE WHEN operator_id <> user_id AND amount < 0 THEN -amount ELSE 0 END),0) AS outAmt,
        COALESCE(SUM(CASE WHEN operator_id = user_id AND amount < 0 THEN -amount ELSE 0 END),0) AS givenAmt,
        COALESCE(SUM(CASE WHEN operator_id = user_id AND amount > 0 THEN amount ELSE 0 END),0) AS takenAmt
        FROM transactions WHERE user_id = ? AND kind = 'transfer' AND ref LIKE 'room-%'`).get(id) as any;
    const daily = d.db.prepare(`SELECT date(created_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS bets, SUM(amount) AS wagered, SUM(net) AS net
        FROM bets WHERE user_id = ? GROUP BY day ORDER BY day DESC LIMIT 30`).all(id);
    const onlineMs = u.total_online_ms + d.presence.liveMs(id);
    const activeDays = (d.db.prepare(`SELECT COUNT(DISTINCT date(started_at/1000,'unixepoch','localtime')) AS n FROM sessions WHERE user_id = ?`).get(id) as any).n;
    res.json({
      player: decorate(u, d.presence),
      stats: {
        ...b, ...t,
        avgBet: b.betCount ? round2(b.wagered / b.betCount) : 0,
        winRate: b.betCount ? round2(b.wins / b.betCount) : 0,
        // 下注频率：每在线小时下的局数 / 注数
        roundsPerHour: onlineMs > 0 ? round2(b.rounds / (onlineMs / 3_600_000)) : 0,
        betsPerHour: onlineMs > 0 ? round2(b.betCount / (onlineMs / 3_600_000)) : 0,
        activeDays,
        onlineMs,
        netDepositFlow: round2(t.deposits - t.withdraws),   // 上下分净额
        ...split, roomTransferIn: roomTransfers.inAmt, roomTransferOut: roomTransfers.outAmt, roomGiven: roomTransfers.givenAmt, roomTaken: roomTransfers.takenAmt,
      },
      byType, daily,
      current: d.presence.current(id) ?? null,
    });
  });

  r.patch('/players/:id', (req, res) => {
    const id = Number(req.params.id);
    const { groupId, vipLevel, status, nickname, canHost, maxRooms } = req.body ?? {};
    if (maxRooms !== undefined && !(Number(maxRooms) >= 0 && Number(maxRooms) <= 50)) throw new HttpError(400, '最大开房数需在 0–50 之间');
    if (status && !['active', 'frozen'].includes(status)) throw new HttpError(400, 'status 无效');
    d.db.prepare(`UPDATE users SET
        group_id = CASE WHEN ? THEN ? ELSE group_id END,
        vip_level = COALESCE(?, vip_level),
        status = COALESCE(?, status),
        nickname = COALESCE(?, nickname),
        can_host = COALESCE(?, can_host),
        max_rooms = COALESCE(?, max_rooms) WHERE id = ?`)
      .run(groupId !== undefined ? 1 : 0, groupId ?? null, vipLevel ?? null, status ?? null, nickname ?? null, canHost === undefined ? null : (canHost ? 1 : 0), maxRooms === undefined ? null : Number(maxRooms), id);
    res.json({ player: decorate(d.db.prepare('SELECT u.*, g.name AS group_name FROM users u LEFT JOIN groups g ON g.id=u.group_id WHERE u.id = ?').get(id), d.presence) });
  });

  /** 上分 / 下分 */
  r.post('/players/:id/adjust', (req, res) => {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const note = String(req.body?.note ?? '').slice(0, 200);
    if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, '金额无效');
    if (!d.auth.getUser(id)) throw new HttpError(404, '玩家不存在');
    const kind = amount > 0 ? 'deposit' : 'withdraw';
    const balance = d.wallet.apply(id, kind, amount, 'admin', { operatorId: req.user!.id, note });
    res.json({ balance, kind });
  });

  r.get('/players/:id/transactions', (req, res) => {
    const id = Number(req.params.id);
    const kind = req.query.kind ? String(req.query.kind) : null;   // deposit,withdraw 逗号分隔
    const kinds = kind ? kind.split(',') : null;
    const limit = Math.min(500, Number(req.query.limit ?? 100));
    const sql = `SELECT t.id, t.kind, t.amount, t.balance, t.ref, t.note, t.created_at, t.operator_id, o.username AS operator
        FROM transactions t LEFT JOIN users o ON o.id = t.operator_id WHERE t.user_id = ? ${kinds ? `AND t.kind IN (${kinds.map(() => '?').join(',')})` : ''}
        ORDER BY t.id DESC LIMIT ?`;
    res.json({ items: d.db.prepare(sql).all(id, ...(kinds ?? []), limit) });
  });

  r.get('/players/:id/bets', (req, res) => {
    const id = Number(req.params.id);
    const limit = Math.min(500, Number(req.query.limit ?? 100));
    res.json({
      items: d.db.prepare(`SELECT b.id, b.round_id, b.table_id, b.bet_type, b.amount, b.returned, b.net, b.created_at,
          r.round_no, r.outcome, r.player_total, r.banker_total, r.player_pair, r.banker_pair, r.player_cards, r.banker_cards
          FROM bets b LEFT JOIN rounds r ON r.id = b.round_id WHERE b.user_id = ? ORDER BY b.id DESC LIMIT ?`).all(id, limit),
    });
  });

  r.get('/players/:id/sessions', (req, res) => {
    const id = Number(req.params.id);
    res.json({ items: d.db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(id) });
  });

  return r;
}

function decorate(u: any, presence: Presence) {
  const online = presence.isOnline(u.id);
  return {
    id: u.id, username: u.username, nickname: u.nickname, vipLevel: u.vip_level, balance: u.balance, status: u.status,
    canHost: !!u.can_host, maxRooms: u.max_rooms ?? 0,
    groupId: u.group_id ?? null, groupName: u.group_name ?? null,
    lastLoginAt: u.last_login_at ?? null, lastIp: u.last_ip ?? null, lastDevice: u.last_device ?? null,
    totalOnlineMs: (u.total_online_ms ?? 0) + presence.liveMs(u.id), createdAt: u.created_at, online,
    wagered: u.wagered ?? 0, net: u.net ?? 0, betCount: u.betCount ?? 0, rounds: u.rounds ?? 0, lastBetAt: u.lastBetAt ?? null,
    wageredPrivate: u.wageredPrivate ?? 0, netPrivate: u.netPrivate ?? 0,
    deposits: u.deposits ?? 0, withdraws: u.withdraws ?? 0,
    avgBet: u.betCount ? round2(u.wagered / u.betCount) : 0,
  };
}

function startOfDay(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}
function round2(n: number) { return Math.round(n * 100) / 100; }
