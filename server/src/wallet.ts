/** 钱包：余额扣减/入账 + 流水记录（同步 SQLite，天然串行，无并发扣款问题） */
import type { DB } from './db/index.js';
import { HttpError } from './auth.js';
import { round2 } from './game/payouts.js';

export type TxKind = 'deposit' | 'withdraw' | 'bet' | 'payout' | 'refund' | 'adjust';

export class Wallet {
  constructor(private db: DB) {}

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
    return next;
  }

  history(userId: number, limit = 50) {
    return this.db
      .prepare('SELECT id, kind, amount, balance, ref, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(userId, limit);
  }
}
