/** 钱包：余额扣减/入账 + 流水记录（同步 SQLite，天然串行，无并发扣款问题） */
import { EventEmitter } from 'node:events';
import type { DB } from './db/index.js';
import { HttpError } from './auth.js';
import { round2 } from './game/payouts.js';

export type TxKind = 'deposit' | 'withdraw' | 'bet' | 'payout' | 'refund' | 'adjust' | 'transfer';   // transfer：私人房房主给成员上下分（房主与成员之间转账）

/** 非牌局内的余额变动（后台上下分、房主上下分）：实时推给玩家 */
export interface BalanceChange { userId: number; kind: TxKind; amount: number; balance: number; note?: string }
const PUSH_KINDS: TxKind[] = ['deposit', 'withdraw', 'adjust', 'transfer'];

export class Wallet extends EventEmitter {
  constructor(private db: DB) { super(); }

  balance(userId: number): number {
    const row = this.db.prepare('SELECT balance FROM users WHERE id = ?').get(userId) as any;
    return row?.balance ?? 0;
  }

  /** amount 正为入账、负为出账；余额不足抛错 */
  apply(userId: number, kind: TxKind, amount: number, ref?: string, meta?: { operatorId?: number; note?: string }): number {
    const cur = this.balance(userId);
    const next = round2(cur + amount);
    if (next < 0) throw new HttpError(402, '余额不足');
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(next, userId);
      this.db
        .prepare('INSERT INTO transactions (user_id, kind, amount, balance, ref, operator_id, note, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(userId, kind, amount, next, ref ?? null, meta?.operatorId ?? null, meta?.note ?? null, now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    if (PUSH_KINDS.includes(kind)) {
      const ev: BalanceChange = { userId, kind, amount, balance: next, note: meta?.note };
      try { this.emit('change', ev); } catch { /* 推送失败不影响入账 */ }
    }
    return next;
  }

  history(userId: number, limit = 50) {
    return this.db
      .prepare('SELECT id, kind, amount, balance, ref, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(userId, limit);
  }
}


/**
 * 私房积分钱包：每个房主名下一套积分，只能在该房主的房间下注。
 *  - 房主本人在自己房间用的也是自己名下的私房积分（由房主从大厅积分"转入"）
 *  - 上分：房主大厅积分 → 成员的（该房主名下）私房积分；下分反向
 *  - 流水记在 transactions，owner_id 标明是哪位房主的私房积分
 */
export class RoomCreditWallet {
  constructor(private db: DB, public readonly ownerId: number) {}

  balance(userId: number): number {
    const row = this.db.prepare('SELECT balance FROM room_credits WHERE user_id = ? AND owner_id = ?').get(userId, this.ownerId) as any;
    return row?.balance ?? 0;
  }

  apply(userId: number, kind: TxKind, amount: number, ref?: string, meta?: { operatorId?: number; note?: string }): number {
    const cur = this.balance(userId);
    const next = round2(cur + amount);
    if (next < 0) throw new HttpError(402, '私房积分不足');
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO room_credits (user_id, owner_id, balance, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(user_id, owner_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`).run(userId, this.ownerId, next, now);
      this.db.prepare('INSERT INTO transactions (user_id, kind, amount, balance, ref, operator_id, note, owner_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(userId, kind, amount, next, ref ?? null, meta?.operatorId ?? null, meta?.note ?? null, this.ownerId, now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return next;
  }
}
