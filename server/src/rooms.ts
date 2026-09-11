/**
 * 私人房间：有开房权限的玩家创建，其他玩家凭密码进入；房主可管理成员、上下分（房主与成员之间转账，通用积分）、限红、上锁、账单导出。
 * 每个房间就是一张 RNG 牌桌（id = room-xxxxxx，hallId = 'private'），人数上限 12。
 */
import { randomBytes } from 'node:crypto';
import type { DB } from './db/index.js';
import { HttpError } from './auth.js';
import type { Wallet } from './wallet.js';
import type { TableManager } from './game/manager.js';
import { DEFAULT_PAYOUTS, round2 } from './game/payouts.js';

export const PRIVATE_HALL = 'private';
export const ROOM_CAPACITY = 12;
export const MAX_ROOMS_PER_OWNER = 50;   // 单人硬上限；实际由后台按人设置 max_rooms
export const MAX_ROOMS_TOTAL = 100;

export interface RoomRow {
  id: string; name: string; owner_id: number; password: string; locked: number;
  min_bet: number; max_bet: number; max_side_bet: number; capacity: number; status: string; created_at: number; closed_at: number | null;
}

export class RoomService {
  constructor(private db: DB, private wallet: Wallet, private tables: TableManager) {
    if (!tables.halls.find((h) => h.id === PRIVATE_HALL)) tables.addHall({ id: PRIVATE_HALL, name: '密码房', kind: 'lobby', minVipLevel: 0 });
  }

  /** 启动时恢复所有活跃房间的牌桌 */
  restore() {
    for (const r of this.db.prepare("SELECT * FROM rooms WHERE status = 'active'").all() as unknown as RoomRow[]) this.mount(r);
  }

  private mount(r: RoomRow) {
    if (this.tables.tables.has(r.id)) return this.tables.get(r.id);
    // 私人房与大厅共用同一套积分；只是统计上按 table_id 前缀 room- 单独分列
    const t = this.tables.addTable({
      id: r.id, name: r.name, kind: 'rng', hallId: PRIVATE_HALL, ownerId: r.owner_id, capacity: r.capacity,
      minBet: r.min_bet, maxBet: r.max_bet, maxSideBet: r.max_side_bet, payouts: DEFAULT_PAYOUTS, bettingSeconds: 15,
    });
    t.start();
    return t;
  }

  row(id: string): RoomRow {
    const r = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
    if (!r) throw new HttpError(404, '房间不存在');
    return r;
  }

  isMember(roomId: string, userId: number): boolean {
    const r = this.row(roomId);
    if (r.owner_id === userId) return true;
    return !!this.db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
  }

  /** 进桌前的校验（HTTP 取快照 / WS 订阅共用）：只有成员能进；上锁后非成员进不来 */
  assertCanEnter(roomId: string, userId: number) {
    const r = this.row(roomId);
    if (r.status === 'closing') throw new HttpError(410, '房间正在关闭');
    if (r.status !== 'active') throw new HttpError(410, '房间已关闭');
    if (!this.isMember(roomId, userId)) throw new HttpError(403, r.locked ? '房间已上锁' : '请先输入房间密码');
  }

  create(ownerId: number, perm: { canHost: boolean; maxRooms: number }, input: { name?: string; password: string; minBet?: number; maxBet?: number; maxSideBet?: number }) {
    if (!perm.canHost) throw new HttpError(403, '你还没有开房权限，请联系管理员开通');
    const limit = Math.min(perm.maxRooms || 0, MAX_ROOMS_PER_OWNER);
    const open = this.db.prepare("SELECT COUNT(*) AS n FROM rooms WHERE owner_id = ? AND status = 'active'").get(ownerId) as any;
    if (open.n >= limit) throw new HttpError(400, `你最多同时开 ${limit} 个房间（管理员设置）`);
    const all = this.db.prepare("SELECT COUNT(*) AS n FROM rooms WHERE status = 'active'").get() as any;
    if (all.n >= MAX_ROOMS_TOTAL) throw new HttpError(400, `私人房间总数已达上限 ${MAX_ROOMS_TOTAL}，请稍后再试`);
    const password = String(input.password ?? '').trim();
    if (!/^[A-Za-z0-9]{4,8}$/.test(password)) throw new HttpError(400, '密码需为 4–8 位字母或数字');
    if (this.db.prepare("SELECT 1 FROM rooms WHERE password = ? AND status = 'active'").get(password)) throw new HttpError(409, '这个密码已被其他房间使用，换一个');
    const limits = normLimits(input);
    const id = `room-${randomBytes(3).toString('hex')}`;
    const name = String(input.name ?? '').trim().slice(0, 16) || `私人房 ${id.slice(-4).toUpperCase()}`;
    const now = Date.now();
    this.db.prepare('INSERT INTO rooms (id, name, owner_id, password, locked, min_bet, max_bet, max_side_bet, capacity, status, created_at) VALUES (?,?,?,?,0,?,?,?,?,?,?)')
      .run(id, name, ownerId, password, limits.minBet, limits.maxBet, limits.maxSideBet, ROOM_CAPACITY, 'active', now);
    this.db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?,?,?)').run(id, ownerId, now);
    this.mount(this.row(id));
    return this.info(id, ownerId);
  }

  /** 凭密码进入：成为成员（上锁时非成员不能进；满员不能进） */
  joinByPassword(userId: number, password: string) {
    const r = this.db.prepare("SELECT * FROM rooms WHERE password = ? AND status = 'active'").get(String(password ?? '').trim()) as RoomRow | undefined;
    if (!r) throw new HttpError(404, '密码不对或房间不存在');
    const member = this.isMember(r.id, userId);
    if (!member) {
      if (r.locked) throw new HttpError(403, '房间已上锁，暂不接受新成员');
      const t = this.tables.get(r.id);
      if (t.isFull) throw new HttpError(409, '房间已满（12 人）');
      this.db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?,?,?)').run(r.id, userId, Date.now());
    }
    return this.info(r.id, userId);
  }

  /** 我的房间：我创建的 + 我加入的（活跃） */
  mine(userId: number) {
    const rows = this.db.prepare(`SELECT r.* FROM rooms r
      WHERE r.status = 'active' AND (r.owner_id = ? OR r.id IN (SELECT room_id FROM room_members WHERE user_id = ?))
      ORDER BY r.owner_id = ? DESC, r.created_at DESC`).all(userId, userId, userId) as unknown as RoomRow[];
    return rows.map((r) => this.info(r.id, userId));
  }

  info(id: string, viewerId: number) {
    const r = this.row(id);
    const t = this.tables.tables.get(id);
    const members = (this.db.prepare('SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?').get(id) as any).n;
    const owner = this.db.prepare('SELECT nickname FROM users WHERE id = ?').get(r.owner_id) as any;
    const isOwner = r.owner_id === viewerId;
    return {
      id: r.id, name: r.name, ownerId: r.owner_id, ownerName: owner?.nickname ?? '', isOwner,
      password: isOwner ? r.password : undefined,
      locked: !!r.locked, status: r.status, capacity: r.capacity, members,
      online: t?.snapshot().playersOnline ?? 0, full: t?.isFull ?? false, phase: t?.phase ?? 'idle', roundNo: t?.roundNo ?? 0,
      limits: { minBet: r.min_bet, maxBet: r.max_bet, maxSideBet: r.max_side_bet }, createdAt: r.created_at,
    };
  }

  private assertOwner(id: string, userId: number): RoomRow {
    const r = this.row(id);
    if (r.owner_id !== userId) throw new HttpError(403, '只有房主可以操作');
    if (r.status !== 'active') throw new HttpError(410, '房间已关闭');
    return r;
  }

  setLocked(id: string, userId: number, locked: boolean) {
    this.assertOwner(id, userId);
    this.db.prepare('UPDATE rooms SET locked = ? WHERE id = ?').run(locked ? 1 : 0, id);
    return this.info(id, userId);
  }

  setLimits(id: string, userId: number, input: { minBet?: number; maxBet?: number; maxSideBet?: number }) {
    this.assertOwner(id, userId);
    const l = normLimits(input);
    this.db.prepare('UPDATE rooms SET min_bet = ?, max_bet = ?, max_side_bet = ? WHERE id = ?').run(l.minBet, l.maxBet, l.maxSideBet, id);
    this.tables.get(id).updateSettings(l);   // 下一局生效
    return this.info(id, userId);
  }

  rename(id: string, userId: number, name: string) {
    this.assertOwner(id, userId);
    const n = String(name ?? '').trim().slice(0, 16);
    if (!n) throw new HttpError(400, '名称不能为空');
    this.db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(n, id);
    (this.tables.get(id).cfg as any).name = n;
    return this.info(id, userId);
  }

  /** 房主给成员上分（amount>0：房主 → 成员）/ 下分（amount<0：成员 → 房主），都是同一套通用积分的转账 */
  transfer(id: string, ownerId: number, memberId: number, amount: number, note?: string) {
    this.assertOwner(id, ownerId);
    if (!this.isMember(id, memberId) || memberId === ownerId) throw new HttpError(400, '对方不是本房成员');
    const v = round2(Math.abs(Number(amount)));
    if (!(v > 0)) throw new HttpError(400, '金额无效');
    const ref = `${id}:${amount > 0 ? 'up' : 'down'}:${memberId}`;
    if (amount > 0) {
      this.wallet.apply(ownerId, 'transfer', -v, ref, { operatorId: ownerId, note: note ?? `房间上分 → ${memberId}` });   // 房主余额不足会抛错
      this.wallet.apply(memberId, 'transfer', v, ref, { operatorId: ownerId, note: note ?? '房主上分' });
    } else {
      this.wallet.apply(memberId, 'transfer', -v, ref, { operatorId: ownerId, note: note ?? '房主下分' });                 // 成员余额不足会抛错
      this.wallet.apply(ownerId, 'transfer', v, ref, { operatorId: ownerId, note: note ?? `房间下分 ← ${memberId}` });
    }
    return { ownerBalance: this.wallet.balance(ownerId), memberBalance: this.wallet.balance(memberId) };
  }

  kick(id: string, ownerId: number, memberId: number) {
    this.assertOwner(id, ownerId);
    if (memberId === ownerId) throw new HttpError(400, '不能移除房主');
    this.db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(id, memberId);
    this.tables.get(id).leave(memberId);
  }

  /** 成员列表 + 每人在本房的流水 / 输赢 / 局数 / 上下分合计 */
  members(id: string, viewerId: number) {
    const r = this.row(id);
    if (!this.isMember(id, viewerId)) throw new HttpError(403, '不是本房成员');
    const t = this.tables.tables.get(id);
    const onlineIds = new Set((t?.snapshot().leaderboard ?? []).map((x: any) => x.userId));
    const rows = this.db.prepare(`SELECT u.id, u.nickname, u.username, u.balance, m.joined_at,
        COALESCE(b.wagered,0) AS wagered, COALESCE(b.net,0) AS net, COALESCE(b.rounds,0) AS rounds,
        COALESCE(tr.up,0) AS up, COALESCE(tr.down,0) AS down
      FROM room_members m JOIN users u ON u.id = m.user_id
      LEFT JOIN (SELECT user_id, SUM(amount) AS wagered, SUM(net) AS net, COUNT(DISTINCT round_id) AS rounds FROM bets WHERE table_id = ? GROUP BY user_id) b ON b.user_id = u.id
      LEFT JOIN (SELECT user_id, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS up, SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS down
                 FROM transactions WHERE kind = 'transfer' AND ref LIKE ? GROUP BY user_id) tr ON tr.user_id = u.id
      WHERE m.room_id = ? ORDER BY (u.id = ?) DESC, wagered DESC`).all(id, `${id}:%`, id, r.owner_id) as any[];
    const isOwner = r.owner_id === viewerId;
    return rows.map((x) => ({
      userId: x.id, nickname: x.nickname, username: isOwner ? x.username : undefined, balance: isOwner ? x.balance : undefined,
      isOwner: x.id === r.owner_id, joinedAt: x.joined_at, online: onlineIds.has(x.id) || (t ? (t as any).online?.has?.(x.id) : false),
      wagered: x.wagered, net: x.net, rounds: x.rounds, up: x.up, down: x.down,
    }));
  }

  /** 房间账单：每局每人每注（导出 CSV 用） */
  ledger(id: string, viewerId: number) {
    this.assertOwner(id, viewerId);
    return this.db.prepare(`SELECT b.created_at, r.round_no, u.nickname, u.username, b.bet_type, b.amount, b.returned, b.net, r.outcome, r.player_total, r.banker_total
      FROM bets b JOIN users u ON u.id = b.user_id LEFT JOIN rounds r ON r.id = b.round_id
      WHERE b.table_id = ? ORDER BY b.created_at ASC`).all(id) as any[];
  }

  /**
   * 关闭房间：投注中 / 空闲时立刻关（本局注码全部退还）；发牌或派彩中则标记为"关闭中"，等本局结算完、下一局开始前再销毁。
   * 销毁时给房内所有人推 table:closed，前端回大厅。
   */
  close(id: string, userId: number) {
    this.assertOwner(id, userId);
    const t = this.tables.tables.get(id);
    if (!t) { this.finalize(id); return { closed: true }; }
    const finalize = () => this.finalize(id);
    if (t.phase === 'betting' || t.phase === 'idle' || t.phase === 'shuffling') {
      if (t.phase === 'betting') t.voidRound('房间关闭');   // 退还本局注码
      finalize();
      return { closed: true };
    }
    // 发牌 / 派彩中：等本局结束（下一局 openBetting 触发 state=betting）再销毁
    this.db.prepare("UPDATE rooms SET status = 'closing' WHERE id = ?").run(id);
    const onState = (snap: any) => {
      if (snap.phase !== 'betting') return;
      t.off('state', onState);
      t.voidRound('房间关闭');   // 新一局刚开还没人下注，直接作废并销毁
      finalize();
    };
    t.on('state', onState);
    return { closed: false, closing: true };
  }

  private finalize(id: string) {
    this.db.prepare("UPDATE rooms SET status = 'closed', closed_at = ? WHERE id = ?").run(Date.now(), id);
    const t = this.tables.tables.get(id);
    if (t) {
      t.stop();
      t.emit('closed', { tableId: id });
      t.removeAllListeners();
      this.tables.tables.delete(id);
      const h = this.tables.halls.find((x) => x.id === PRIVATE_HALL);
      if (h) h.tableIds = h.tableIds.filter((x) => x !== id);
    }
  }

  /** 后台：全部房间（含已关闭） */
  adminList() {
    const rows = this.db.prepare(`SELECT r.*, u.nickname AS owner_name,
        (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS members,
        (SELECT COALESCE(SUM(amount),0) FROM bets b WHERE b.table_id = r.id) AS wagered,
        (SELECT COALESCE(SUM(net),0) FROM bets b WHERE b.table_id = r.id) AS playerNet,
        (SELECT COUNT(*) FROM rounds x WHERE x.table_id = r.id) AS rounds
      FROM rooms r JOIN users u ON u.id = r.owner_id ORDER BY r.status = 'active' DESC, r.created_at DESC`).all() as any[];
    return rows.map((r) => {
      const t = this.tables.tables.get(r.id);
      return { ...r, online: t?.snapshot().playersOnline ?? 0, phase: t?.phase ?? '-', locked: !!r.locked };
    });
  }
}

function normLimits(i: { minBet?: number; maxBet?: number; maxSideBet?: number }) {
  const minBet = clamp(Number(i.minBet ?? 50), 1, 1e7);
  const maxBet = clamp(Number(i.maxBet ?? 20000), minBet, 1e8);
  const maxSideBet = clamp(Number(i.maxSideBet ?? Math.round(maxBet / 10)), 1, maxBet);
  return { minBet, maxBet, maxSideBet };
}
const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
