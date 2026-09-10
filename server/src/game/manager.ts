/** 大厅 / VIP 厅 / 牌桌 的组织与持久化适配 */
import type { DB } from '../db/index.js';
import { BaccaratTable, type Persistence, type TableConfig, type WalletPort } from './table.js';
import { NO_COMMISSION_PAYOUTS, DEFAULT_PAYOUTS } from './payouts.js';

export interface Hall {
  id: string;
  name: string;
  kind: 'lobby' | 'vip';
  /** 进入门槛：玩家 vip_level >= minVipLevel */
  minVipLevel: number;
  tableIds: string[];
}

export class SqlitePersistence implements Persistence {
  constructor(private db: DB) {}
  saveShoe(tableId: string, shoeId: string, fingerprint: string | null, deckCount: number) {
    this.db.prepare('INSERT OR IGNORE INTO shoes (id, table_id, fingerprint, deck_count, created_at) VALUES (?,?,?,?,?)')
      .run(shoeId, tableId, fingerprint, deckCount, Date.now());
  }
  saveRound(tableId: string, shoeId: string, roundId: string, roundNo: number, r: any, startedAt: number) {
    this.db.prepare(`INSERT INTO rounds (id, table_id, shoe_id, round_no, player_cards, banker_cards, outcome,
        player_total, banker_total, player_pair, banker_pair, started_at, settled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(roundId, tableId, shoeId, roundNo, JSON.stringify(r.playerCards), JSON.stringify(r.bankerCards), r.outcome,
        r.playerTotal, r.bankerTotal, r.playerPair ? 1 : 0, r.bankerPair ? 1 : 0, startedAt, Date.now());
  }
  saveBets(roundId: string, tableId: string, userId: number, settlements: any[]) {
    const stmt = this.db.prepare('INSERT INTO bets (round_id, table_id, user_id, bet_type, amount, returned, net, created_at) VALUES (?,?,?,?,?,?,?,?)');
    for (const s of settlements) stmt.run(roundId, tableId, userId, s.type, s.amount, s.returned, s.net, Date.now());
  }
}

export class TableManager {
  halls: Hall[] = [];
  tables = new Map<string, BaccaratTable>();

  constructor(private wallet: WalletPort, private store: Persistence) {}

  addHall(hall: Omit<Hall, 'tableIds'>): Hall {
    const h = { ...hall, tableIds: [] };
    this.halls.push(h);
    return h;
  }

  addTable(cfg: ConstructorParameters<typeof BaccaratTable>[0]): BaccaratTable {
    const t = new BaccaratTable(cfg, this.wallet, this.store);
    this.tables.set(t.cfg.id, t);
    this.halls.find((h) => h.id === cfg.hallId)?.tableIds.push(t.cfg.id);
    return t;
  }

  get(id: string): BaccaratTable {
    const t = this.tables.get(id);
    if (!t) throw new Error(`table ${id} not found`);
    return t;
  }

  startAll() {
    for (const t of this.tables.values()) t.start();
  }

  stopAll() {
    for (const t of this.tables.values()) t.stop();
  }

  hallOf(tableId: string): Hall | undefined {
    return this.halls.find((h) => h.tableIds.includes(tableId));
  }
}

/**
 * 默认布局：
 *  大厅：12 张 RNG 桌（不同限红/免佣）
 *  VIP：3 个厅 × 5 张实况桌
 */
export function seedDefaultLayout(m: TableManager, opts: { mediaBase: string; rngTables?: number; vipHalls?: number }) {
  const lobby = m.addHall({ id: 'lobby', name: '大厅', kind: 'lobby', minVipLevel: 0 });
  const n = opts.rngTables ?? 12;
  for (let i = 1; i <= n; i++) {
    const tier = i % 3; // 三档限红
    m.addTable({
      id: `rng-${i}`, name: `快速桌 ${i}`, kind: 'rng', hallId: lobby.id,
      minBet: [10, 50, 200][tier], maxBet: [5000, 20000, 100000][tier], maxSideBet: [500, 2000, 10000][tier],
      payouts: i % 4 === 0 ? NO_COMMISSION_PAYOUTS : DEFAULT_PAYOUTS,
      bettingSeconds: 12,
    });
  }
  const dealers = ['Alice', 'Bella', 'Cindy', 'Diana', 'Elsa', 'Fiona', 'Grace', 'Hanna', 'Iris', 'Jade', 'Kira', 'Luna', 'Mia', 'Nora', 'Olivia'];
  const hallCount = opts.vipHalls ?? 3;
  for (let h = 1; h <= hallCount; h++) {
    const hall = m.addHall({ id: `vip-${h}`, name: `VIP ${h} 厅`, kind: 'vip', minVipLevel: h });
    for (let t = 1; t <= 5; t++) {
      const idx = (h - 1) * 5 + (t - 1);
      const id = `vip${h}-t${t}`;
      m.addTable({
        id, name: `VIP${h}-${t} 桌`, kind: 'live', hallId: hall.id,
        minBet: 100 * h, maxBet: 200000 * h, maxSideBet: 20000 * h,
        bettingSeconds: 20, resultPauseSeconds: 9,
        dealerName: dealers[idx % dealers.length],
        // WHEP：浏览器用 WebRTC 拉流。荷官摄像头推流地址为 {mediaBase}/rtc/v1/whip/?app=live&stream={id}
        stream: {
          whepUrl: `${opts.mediaBase}/rtc/v1/whep/?app=live&stream=${id}`,
          fallbackHlsUrl: `${opts.mediaBase}/live/${id}.m3u8`,
        },
      });
    }
  }
}
