import { Router, type Request, type Response, type NextFunction } from 'express';
import { AuthService, HttpError, type User } from '../auth.js';
import type { Wallet } from '../wallet.js';
import type { TableManager } from '../game/manager.js';
import type { Card, Rank, Suit } from '../game/types.js';
import type { DB } from '../db/index.js';
import { clientIp, deviceFromUa } from '../presence.js';
import { PRIVATE_HALL, type RoomService } from '../rooms.js';

export interface Deps {
  auth: AuthService;
  wallet: Wallet;
  tables: TableManager;
  db: DB;
  dealerApiKey: string;
  rooms: RoomService;
}

declare global {
  namespace Express {
    interface Request { user?: User }
  }
}

export function apiRouter(d: Deps): Router {
  const r = Router();

  const requireUser = (req: Request, _res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || (typeof req.query.token === 'string' ? req.query.token : undefined);   // 下载类链接用 ?token=
    const user = d.auth.authenticate(token);
    if (!user) return next(new HttpError(401, '未登录'));
    req.user = user;
    next();
  };

  // ---------- 账号 ----------
  const loginCtx = (req: Request) => ({
    ip: clientIp(req.headers as any, req.socket.remoteAddress),
    device: String(req.headers['x-device'] ?? '') || deviceFromUa(req.headers['user-agent']),
  });

  r.post('/auth/register', (req, res) => {
    const { username, password, nickname } = req.body ?? {};
    d.auth.register(String(username ?? ''), String(password ?? ''), nickname);
    res.json(d.auth.login(username, password, loginCtx(req)));
  });

  r.post('/auth/login', (req, res) => {
    const { username, password } = req.body ?? {};
    res.json(d.auth.login(String(username ?? ''), String(password ?? ''), loginCtx(req)));
  });

  r.get('/me', requireUser, (req, res) => res.json({ user: req.user }));
  r.get('/me/transactions', requireUser, (req, res) => res.json({ items: d.wallet.history(req.user!.id) }));
  r.get('/me/bets', requireUser, (req, res) => {
    const items = d.db.prepare(`SELECT b.*, r.outcome, r.player_total, r.banker_total FROM bets b
        JOIN rounds r ON r.id = b.round_id WHERE b.user_id = ? ORDER BY b.id DESC LIMIT 100`).all(req.user!.id);
    res.json({ items });
  });

  /** 演示用充值（生产替换为支付回调） */
  r.post('/me/deposit', requireUser, (req, res) => {
    const amount = Number(req.body?.amount);
    if (!(amount > 0) || amount > 1_000_000) throw new HttpError(400, '金额无效');
    res.json({ balance: d.wallet.apply(req.user!.id, 'deposit', amount, 'demo deposit') });
  });

  // ---------- 大厅 / 牌桌 ----------
  r.get('/halls', requireUser, (req, res) => {
    const vip = req.user!.vipLevel;
    res.json({
      halls: d.tables.halls.filter((h) => h.id !== PRIVATE_HALL).map((h) => ({
        ...h, locked: vip < h.minVipLevel,
        tables: h.tableIds.map((id) => d.tables.get(id).summary()),
      })),
    });
  });

  r.get('/tables/:id', requireUser, (req, res) => {
    const t = d.tables.get(req.params.id);
    const hall = d.tables.hallOf(t.cfg.id);
    if (hall && req.user!.vipLevel < hall.minVipLevel) throw new HttpError(403, `需要 VIP${hall.minVipLevel} 等级`);
    if (t.cfg.hallId === PRIVATE_HALL) d.rooms.assertCanEnter(t.cfg.id, req.user!.id);
    res.json({ table: t.snapshot(), myBets: t.getBets(req.user!.id), room: t.cfg.hallId === PRIVATE_HALL ? d.rooms.info(t.cfg.id, req.user!.id) : null });   // room.credit = 我在本房可用的私房积分
  });

  r.post('/tables/:id/bets', requireUser, (req, res) => {
    const t = d.tables.get(req.params.id);
    try {
      res.json(t.placeBets(req.user!.id, req.user!.nickname, req.body?.bets ?? {}));
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  });

  r.delete('/tables/:id/bets', requireUser, (req, res) => {
    const t = d.tables.get(req.params.id);
    res.json({ balance: t.clearBets(req.user!.id) });
  });

  // ---------- 私人房间 ----------
  r.get('/rooms/mine', requireUser, (req, res) => res.json({ items: d.rooms.mine(req.user!.id) }));
  r.post('/rooms', requireUser, (req, res) => res.json(d.rooms.create(req.user!.id, { canHost: req.user!.canHost, maxRooms: req.user!.maxRooms }, req.body ?? {})));
  r.post('/rooms/join', requireUser, (req, res) => res.json(d.rooms.joinByPassword(req.user!.id, req.body?.password)));
  r.get('/rooms/:id', requireUser, (req, res) => { d.rooms.assertCanEnter(req.params.id, req.user!.id); res.json(d.rooms.info(req.params.id, req.user!.id)); });
  r.get('/rooms/:id/members', requireUser, (req, res) => res.json({ items: d.rooms.members(req.params.id, req.user!.id) }));
  r.patch('/rooms/:id', requireUser, (req, res) => {
    const b = req.body ?? {};
    let info = d.rooms.info(req.params.id, req.user!.id);
    if (typeof b.locked === 'boolean') info = d.rooms.setLocked(req.params.id, req.user!.id, b.locked);
    if (b.minBet != null || b.maxBet != null || b.maxSideBet != null) info = d.rooms.setLimits(req.params.id, req.user!.id, b);
    if (typeof b.name === 'string') info = d.rooms.rename(req.params.id, req.user!.id, b.name);
    res.json(info);
  });
  r.post('/rooms/:id/transfer', requireUser, (req, res) => res.json(d.rooms.transfer(req.params.id, req.user!.id, Number(req.body?.userId), Number(req.body?.amount), req.body?.note)));
  r.delete('/rooms/:id/members/:uid', requireUser, (req, res) => { d.rooms.kick(req.params.id, req.user!.id, Number(req.params.uid)); res.json({ ok: true }); });
  r.delete('/rooms/:id', requireUser, (req, res) => { d.rooms.close(req.params.id, req.user!.id); res.json({ ok: true }); });
  r.get('/rooms/:id/ledger.csv', requireUser, (req, res) => {
    const rows = d.rooms.ledger(req.params.id, req.user!.id);
    const info = d.rooms.info(req.params.id, req.user!.id);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['时间', '局号', '玩家', '账号', '投注区', '注码', '返还', '输赢', '结果', '闲点', '庄点'];
    const lines = rows.map((x) => [new Date(x.created_at).toLocaleString('zh-CN', { hour12: false }), x.round_no, x.nickname, x.username, x.bet_type, x.amount, x.returned, x.net, x.outcome, x.player_total, x.banker_total].map(esc).join(','));
    const totalW = rows.reduce((a, x) => a + x.amount, 0), totalN = rows.reduce((a, x) => a + (x.net ?? 0), 0);
    lines.push(['合计', '', '', '', '', totalW, '', totalN, '', '', ''].map(esc).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const fname = encodeURIComponent(`${info.name}-账单.csv`);
    res.setHeader('Content-Disposition', `attachment; filename="room-${info.id.slice(5)}.csv"; filename*=UTF-8''${fname}`);
    res.send('\ufeff' + head.map(esc).join(',') + '\n' + lines.join('\n'));
  });

  r.get('/tables/:id/rounds', requireUser, (req, res) => {
    const items = d.db.prepare('SELECT * FROM rounds WHERE table_id = ? ORDER BY round_no DESC LIMIT 100').all(req.params.id);
    res.json({ items });
  });

  // ---------- 荷官 / ETG 设备接口（VIP 实况桌） ----------
  // 鉴权：X-Dealer-Key 头 或 role=dealer/admin 的 JWT
  const requireDealer = (req: Request, _res: Response, next: NextFunction) => {
    const key = req.headers['x-dealer-key'];
    if (key && key === d.dealerApiKey) return next();
    const user = d.auth.authenticate(req.headers.authorization?.replace(/^Bearer /, ''));
    if (user && (user.role === 'dealer' || user.role === 'admin')) return next();
    next(new HttpError(401, 'dealer auth required'));
  };

  const dealer = Router();
  dealer.use(requireDealer);

  dealer.post('/tables/:id/open', (req, res) => {           // 开始投注
    const t = d.tables.get(req.params.id);
    t.openBetting();
    res.json({ ok: true, roundId: t.roundId, roundNo: t.roundNo });
  });
  dealer.post('/tables/:id/close', (req, res) => {          // 提前封盘
    d.tables.get(req.params.id).closeBetting();
    res.json({ ok: true });
  });
  /**
   * 喂牌：body { card: "HK" }  (rank + suit：A23456789TJQK × SHDC)
   * RFID 读卡器把卡片 UID 映射成牌面后调用；摄像头识别方案同理。
   * 返回该牌应放置的位置（闲/庄）以及本局是否已发完 —— 荷官端可据此提示"补牌"。
   */
  dealer.post('/tables/:id/card', (req, res) => {
    const card = parseCard(String(req.body?.card ?? ''));
    try {
      res.json(d.tables.get(req.params.id).dealerCard(card));
    } catch (e: any) {
      throw new HttpError(409, e.message);
    }
  });
  dealer.post('/tables/:id/shuffle', (req, res) => {
    d.tables.get(req.params.id).dealerShuffle();
    res.json({ ok: true });
  });
  dealer.post('/tables/:id/void', (req, res) => {
    d.tables.get(req.params.id).voidRound(req.body?.reason);
    res.json({ ok: true });
  });
  dealer.get('/tables/:id', (req, res) => res.json(d.tables.get(req.params.id).snapshot()));

  r.use('/dealer', dealer);

  return r;
}

export function parseCard(s: string): Card {
  const m = /^([A23456789TJQK])([SHDC])$/i.exec(s.trim());
  if (!m) throw new HttpError(400, `invalid card "${s}", expected e.g. "HK" (rank+suit)`);
  return { rank: m[1].toUpperCase() as Rank, suit: m[2].toUpperCase() as Suit };
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : /not found$/.test(err?.message ?? '') ? 404 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message ?? 'internal error' });
}
