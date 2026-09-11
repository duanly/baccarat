/**
 * 单张牌桌的状态机。
 *
 *  RNG 桌（大厅）  ：定时器驱动 —— 投注倒计时 → 从 Shoe 逐张发牌（带动画间隔）→ 结算 → 停顿 → 下一局；切牌到达后洗牌换靴
 *  实况桌（VIP 厅）：荷官/ETG 驱动 —— 荷官端调用 openBetting()，倒计时结束封盘；
 *                    RFID 读卡器 / 摄像头识别出的每一张牌通过 dealerCard() 喂入；引擎判定落点与补牌；发完自动结算
 *
 * 两种桌共用同一套投注、结算、牌路、排行榜逻辑。
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { BetType, Card, HandResult, TableKind, TablePhase } from './types.js';
import { BET_TYPES } from './types.js';

/** 已下架的玩法（前端不显示，服务端拒收） */
const DISABLED_BETS = new Set<string>(['perfectPair', 'lucky7']);

const BET_NAMES: Record<string, string> = {
  player: '闲', banker: '庄', tie: '和', playerPair: '闲对', bankerPair: '庄对', anyPair: '任意对子',
  perfectPair: '完美对子', lucky6: '幸运6', lucky7: '幸运7', big: '大', small: '小',
};
import { Shoe } from './rng.js';
import { Hand } from './rules.js';
import { DEFAULT_PAYOUTS, settleBets, round2, type PayoutTable, type BetSettlement } from './payouts.js';
import { buildRoadmap, type Roadmap, type RoundSummary } from './roadmap.js';

export interface TableConfig {
  id: string;
  name: string;
  kind: TableKind;
  hallId: string;
  minBet: number;
  maxBet: number;
  /** 边注单注上限（对子/幸运等赔率高，通常单独限红） */
  maxSideBet: number;
  bettingSeconds: number;
  resultPauseSeconds: number;
  /** RNG 桌逐张发牌的动画间隔（毫秒） */
  dealIntervalMs: number;
  payouts: PayoutTable;
  /** 实况桌：WebRTC(WHEP) 播放地址；荷官名 */
  stream?: { whepUrl: string; fallbackHlsUrl?: string };
  dealerName?: string;
}

export type Bets = Partial<Record<BetType, number>>;

export interface PlayerSessionStats {
  userId: number;
  nickname: string;
  wagered: number;   // 本桌累计押注流水
  net: number;       // 本桌累计输赢
  rounds: number;
}

/** 推送给客户端的排行榜条目 */
export interface LeaderboardEntry extends PlayerSessionStats {
  currentBets: Bets;        // 本局各区押注
  currentTotal: number;     // 本局押注合计
  allIn: boolean;           // 本局梭哈
  lastNet: number | null;   // 上一局输赢
}

export interface TableSnapshot {
  id: string;
  name: string;
  kind: TableKind;
  hallId: string;
  phase: TablePhase;
  roundId: string | null;
  roundNo: number;
  shoeId: string | null;
  countdownEndsAt: number | null;
  /** RNG 桌：下一局开始投注的时间（结算阶段用来做开局倒计时） */
  nextRoundAt: number | null;
  playerCards: Card[];
  bankerCards: Card[];
  playerTotal: number;
  bankerTotal: number;
  lastResult: HandResult | null;
  roadmap: Roadmap;
  limits: { minBet: number; maxBet: number; maxSideBet: number };
  payouts: PayoutTable;
  stream?: TableConfig['stream'];
  dealerName?: string;
  playersOnline: number;
  leaderboard: LeaderboardEntry[];
  serverTime: number;
}

export interface WalletPort {
  apply(userId: number, kind: 'bet' | 'payout' | 'refund', amount: number, ref?: string): number;
  balance(userId: number): number;
}

export interface Persistence {
  saveShoe(tableId: string, shoeId: string, fingerprint: string | null, deckCount: number): void;
  saveRound(tableId: string, shoeId: string, roundId: string, roundNo: number, r: HandResult, startedAt: number): void;
  saveBets(roundId: string, tableId: string, userId: number, settlements: BetSettlement[]): void;
}

export interface TableEvents {
  state: (snap: TableSnapshot) => void;                        // 阶段变化 / 全量快照
  card: (e: { tableId: string; side: 'player' | 'banker'; card: Card; playerTotal: number; bankerTotal: number }) => void;
  result: (e: { tableId: string; roundId: string; result: HandResult; roadmap: Roadmap }) => void;
  bets: (e: { tableId: string; leaderboard: LeaderboardEntry[] }) => void;
  settled: (e: { tableId: string; roundId: string; userId: number; settlements: BetSettlement[]; balance: number }) => void;
}

export class BaccaratTable extends EventEmitter {
  readonly cfg: TableConfig;
  phase: TablePhase = 'idle';
  roundId: string | null = null;
  roundNo = 0;
  countdownEndsAt: number | null = null;
  nextRoundAt: number | null = null;
  private shoe: Shoe | null = null;
  private liveShoeId: string | null = null;
  private hand = new Hand();
  private lastResult: HandResult | null = null;
  private history: RoundSummary[] = [];
  private roadmap: Roadmap = buildRoadmap([]);
  private bets = new Map<number, Bets>();
  private allIns = new Set<number>();   // 本局梭哈的玩家
  private sessions = new Map<number, PlayerSessionStats>();
  private lastNets = new Map<number, number>();
  private nicknames = new Map<number, string>();
  private roundStartedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private online = new Set<number>();
  private running = false;

  constructor(cfg: Partial<TableConfig> & Pick<TableConfig, 'id' | 'name' | 'kind' | 'hallId'>, private wallet: WalletPort, private store: Persistence) {
    super();
    this.cfg = {
      minBet: 10,
      maxBet: 10000,
      maxSideBet: 1000,
      bettingSeconds: cfg.kind === 'rng' ? 15 : 20,
      resultPauseSeconds: cfg.kind === 'rng' ? 4.5 : 9,   // 结算画面 1.5s + 渐隐/开局倒计时 3s
      dealIntervalMs: 2200,                            // 逐张发牌间隔（放慢，含飞牌动画）
      payouts: DEFAULT_PAYOUTS,
      ...cfg,
    };
  }

  /** 后台调整参数：下一局生效（正在进行的倒计时不打断） */
  updateSettings(patch: Partial<Pick<TableConfig, 'bettingSeconds' | 'dealIntervalMs' | 'resultPauseSeconds' | 'minBet' | 'maxBet' | 'maxSideBet'>>) {
    const clamp = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
    const next = {
      bettingSeconds: clamp(patch.bettingSeconds, 5, 120),
      dealIntervalMs: clamp(patch.dealIntervalMs, 500, 10000),
      resultPauseSeconds: clamp(patch.resultPauseSeconds, 4.5, 60),
      minBet: clamp(patch.minBet, 1, 1e9),
      maxBet: clamp(patch.maxBet, 1, 1e9),
      maxSideBet: clamp(patch.maxSideBet, 1, 1e9),
    };
    for (const [k, v] of Object.entries(next)) if (v !== undefined) (this.cfg as any)[k] = v;
    this.emit('settings', { tableId: this.cfg.id });
  }

  // ---------- 生命周期 ----------

  /** RNG 桌：开始自动循环。实况桌：进入 idle 等待荷官 */
  start() {
    if (this.cfg.kind === 'rng') {
      this.running = true;
      this.newShoe();
      this.openBetting();
    } else {
      this.liveShoeId = randomUUID().slice(0, 8);
      this.store.saveShoe(this.cfg.id, this.liveShoeId, null, 8);
      this.setPhase('idle');
    }
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setPhase(p: TablePhase) {
    this.phase = p;
    this.emit('state', this.snapshot());
  }

  private schedule(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
  }

  private newShoe() {
    this.shoe = new Shoe();
    this.history = [];
    this.roadmap = buildRoadmap([]);
    this.store.saveShoe(this.cfg.id, this.shoe.shoeId, this.shoe.seedFingerprint, this.shoe.deckCount);
  }

  get shoeId(): string | null {
    return this.cfg.kind === 'rng' ? this.shoe?.shoeId ?? null : this.liveShoeId;
  }

  /** 开始新一局投注（RNG 自动调用；实况桌由荷官触发） */
  openBetting() {
    if (this.phase === 'betting' || this.phase === 'dealing') throw new Error(`table busy: ${this.phase}`);
    this.roundId = randomUUID();
    this.roundNo += 1;
    this.roundStartedAt = Date.now();
    this.hand = new Hand();
    this.bets.clear();
    this.allIns.clear();
    this.countdownEndsAt = Date.now() + this.cfg.bettingSeconds * 1000;
    this.nextRoundAt = null;
    this.setPhase('betting');
    this.emitBets();
    this.schedule(this.cfg.bettingSeconds * 1000, () => this.closeBetting());
  }

  /** 封盘 */
  closeBetting() {
    if (this.phase !== 'betting') return;
    this.countdownEndsAt = null;
    this.setPhase('dealing');
    // RNG 桌：等前端"停止下注"横幅（1.4s）播完再留 0.3s 空隙才发第一张牌
    if (this.cfg.kind === 'rng') this.schedule(1700, () => this.dealNextRngCard());
    // 实况桌：等待荷官喂牌
  }

  private dealNextRngCard() {
    if (!this.shoe) return;
    if (this.hand.complete) return this.settle();
    const side = this.hand.feed(this.shoe.draw());
    const card = (side === 'player' ? this.hand.playerCards : this.hand.bankerCards).at(-1)!;
    this.emitCard(side, card);
    this.schedule(this.cfg.dealIntervalMs, () => this.dealNextRngCard());
  }

  /** 实况桌：荷官端 / RFID / 摄像头识别喂入一张牌 */
  dealerCard(card: Card): { side: 'player' | 'banker'; complete: boolean } {
    if (this.cfg.kind !== 'live') throw new Error('not a live table');
    if (this.phase === 'betting') this.closeBetting(); // 荷官提前开牌 = 立即封盘
    if (this.phase !== 'dealing') throw new Error(`cannot deal in phase ${this.phase}`);
    const side = this.hand.feed(card);
    this.emitCard(side, card);
    const complete = this.hand.complete;
    if (complete) this.settle();
    return { side, complete };
  }

  /** 实况桌：荷官换靴 */
  dealerShuffle() {
    if (this.cfg.kind !== 'live') throw new Error('not a live table');
    if (this.phase === 'betting' || this.phase === 'dealing') throw new Error('round in progress');
    this.liveShoeId = randomUUID().slice(0, 8);
    this.history = [];
    this.roadmap = buildRoadmap([]);
    this.roundNo = 0;
    this.store.saveShoe(this.cfg.id, this.liveShoeId, null, 8);
    this.setPhase('idle');
  }

  /** 作废本局（荷官操作失误/设备故障）：退还所有注码 */
  voidRound(reason = 'void') {
    if (this.phase !== 'betting' && this.phase !== 'dealing') throw new Error('no round to void');
    for (const [userId, bets] of this.bets) {
      const total = sumBets(bets);
      if (total > 0) {
        const balance = this.wallet.apply(userId, 'refund', total, `${this.roundId}:${reason}`);
        this.emit('settled', { tableId: this.cfg.id, roundId: this.roundId!, userId, settlements: [], balance });
      }
    }
    this.bets.clear();
    this.countdownEndsAt = null;
    this.hand = new Hand();
    if (this.timer) clearTimeout(this.timer);
    this.setPhase(this.cfg.kind === 'rng' ? 'settling' : 'idle');
    if (this.cfg.kind === 'rng') { this.nextRoundAt = Date.now() + this.cfg.resultPauseSeconds * 1000; this.schedule(this.cfg.resultPauseSeconds * 1000, () => this.afterRound()); }
  }

  private emitCard(side: 'player' | 'banker', card: Card) {
    const { handTotalOf } = this;
    this.emit('card', {
      tableId: this.cfg.id, side, card,
      playerTotal: handTotalOf(this.hand.playerCards), bankerTotal: handTotalOf(this.hand.bankerCards),
    });
  }

  private handTotalOf = (cards: Card[]) => cards.reduce((s, c) => s + valueOf(c), 0) % 10;

  private settle() {
    const result = this.hand.result();
    this.lastResult = result;
    this.history.push({ outcome: result.outcome, playerPair: result.playerPair, bankerPair: result.bankerPair });
    this.roadmap = buildRoadmap(this.history);
    this.store.saveRound(this.cfg.id, this.shoeId!, this.roundId!, this.roundNo, result, this.roundStartedAt);

    this.lastNets.clear();
    for (const [userId, bets] of this.bets) {
      const settlements = settleBets(bets, result, this.cfg.payouts);
      const returned = round2(settlements.reduce((s, x) => s + x.returned, 0));
      const net = round2(settlements.reduce((s, x) => s + x.net, 0));
      const balance = returned > 0 ? this.wallet.apply(userId, 'payout', returned, this.roundId!) : this.wallet.balance(userId);
      this.store.saveBets(this.roundId!, this.cfg.id, userId, settlements);
      const st = this.sessions.get(userId)!;
      st.net = round2(st.net + net);
      st.rounds += 1;
      this.lastNets.set(userId, net);
      this.emit('settled', { tableId: this.cfg.id, roundId: this.roundId!, userId, settlements, balance });
    }
    this.nextRoundAt = this.cfg.kind === 'rng' ? Date.now() + this.cfg.resultPauseSeconds * 1000 : null;
    this.setPhase('settling');
    this.emit('result', { tableId: this.cfg.id, roundId: this.roundId!, result, roadmap: this.roadmap, nextRoundAt: this.nextRoundAt });
    this.emitBets();
    this.schedule(this.cfg.resultPauseSeconds * 1000, () => this.afterRound());
  }

  private afterRound() {
    this.bets.clear();
    if (this.cfg.kind === 'rng') {
      if (!this.running) return;
      if (this.shoe!.needsShuffle) {
        this.setPhase('shuffling');
        this.schedule(3000, () => {
          this.newShoe();
          this.roundNo = 0;
          this.openBetting();
        });
      } else {
        this.openBetting();
      }
    } else {
      this.setPhase('idle');
    }
  }

  // ---------- 投注 ----------

  /**
   * 追加投注（同一局内可多次下注，累加）；余额即时扣除。
   * 余额不足时不报错，而是把最后能压的部分全部压上（梭哈 / ALL IN），返回 allIn=true。
   */
  placeBets(userId: number, nickname: string, add: Bets): { bets: Bets; balance: number; allIn: boolean } {
    if (this.phase !== 'betting') throw new Error('当前不在投注时间');
    if (this.countdownEndsAt && Date.now() > this.countdownEndsAt) throw new Error('已封盘');
    const cur = this.bets.get(userId) ?? {};
    let total = 0;
    let remaining = this.wallet.balance(userId);
    if (remaining <= 0) throw new Error('余额不足');
    let allIn = false;
    const merged: Bets = { ...cur };
    for (const [t, raw] of Object.entries(add) as [BetType, number][]) {
      if (!BET_TYPES.includes(t)) throw new Error(`未知投注区 ${t}`);
      if (DISABLED_BETS.has(t)) throw new Error(`「${BET_NAMES[t] ?? t}」暂未开放`);
      if (!(raw > 0) || !Number.isFinite(raw)) throw new Error('投注金额无效');
      let v = raw;
      if (v > remaining) { v = round2(remaining); allIn = true; }   // 剩多少压多少
      if (v <= 0) continue;
      remaining = round2(remaining - v);
      const next = round2((merged[t] ?? 0) + v);
      const isMain = t === 'player' || t === 'banker' || t === 'tie';
      const cap = isMain ? this.cfg.maxBet : this.cfg.maxSideBet;
      if (next > cap) throw new Error(`「${BET_NAMES[t] ?? t}」超过限红 ${cap.toLocaleString()}`);
      merged[t] = next;
      total = round2(total + v);
    }
    if (total < this.cfg.minBet && sumBets(cur) === 0) throw new Error(`最低投注 ${this.cfg.minBet}`);
    // 庄/闲互斥（多数平台禁止同局对冲）
    if (merged.player && merged.banker) throw new Error('庄闲不可同时投注');

    const balance = this.wallet.apply(userId, 'bet', -total, this.roundId!);
    this.bets.set(userId, merged);
    if (allIn || balance === 0) this.allIns.add(userId);
    this.nicknames.set(userId, nickname);
    const st = this.sessions.get(userId) ?? { userId, nickname, wagered: 0, net: 0, rounds: 0 };
    st.wagered = round2(st.wagered + total);
    st.nickname = nickname;
    this.sessions.set(userId, st);
    this.emitBets();
    return { bets: merged, balance, allIn: allIn || balance === 0 };
  }

  /** 撤销本局全部投注（封盘前） */
  clearBets(userId: number): number {
    if (this.phase !== 'betting') throw new Error('当前不可撤注');
    const cur = this.bets.get(userId);
    const total = cur ? sumBets(cur) : 0;
    if (!total) return this.wallet.balance(userId);
    this.bets.delete(userId);
    this.allIns.delete(userId);
    const st = this.sessions.get(userId)!;
    st.wagered = round2(st.wagered - total);
    const balance = this.wallet.apply(userId, 'refund', total, this.roundId!);
    this.emitBets();
    return balance;
  }

  /** 撤回某一个投注区的全部注码（已确认部分退款） */
  clearBet(userId: number, type: BetType): { bets: Bets; balance: number } {
    if (this.phase !== 'betting') throw new Error('当前不可撤注');
    const cur = this.bets.get(userId) ?? {};
    const amt = cur[type] ?? 0;
    if (!amt) return { bets: cur, balance: this.wallet.balance(userId) };
    const next = { ...cur }; delete next[type];
    if (sumBets(next) > 0) this.bets.set(userId, next); else this.bets.delete(userId);
    this.allIns.delete(userId);
    const st = this.sessions.get(userId)!;
    st.wagered = round2(st.wagered - amt);
    const balance = this.wallet.apply(userId, 'refund', amt, `${this.roundId}:${type}`);
    this.emitBets();
    return { bets: next, balance };
  }

  getBets(userId: number): Bets {
    return this.bets.get(userId) ?? {};
  }

  // ---------- 在线人数 / 排行榜 ----------

  join(userId: number, nickname: string) {
    this.online.add(userId);
    this.nicknames.set(userId, nickname);
    if (!this.sessions.has(userId)) this.sessions.set(userId, { userId, nickname, wagered: 0, net: 0, rounds: 0 });
    this.emitBets();
  }

  leave(userId: number) {
    this.online.delete(userId);
    this.emitBets();
  }

  /**
   * 玩家押注/输赢面板。
   * 排序：按押注流水（本桌累计投注额）降序；流水相同再按输赢绝对值降序。
   */
  leaderboard(): LeaderboardEntry[] {
    const rows: LeaderboardEntry[] = [];
    for (const st of this.sessions.values()) {
      const cur = this.bets.get(st.userId) ?? {};
      if (!this.online.has(st.userId) && st.wagered === 0) continue;
      rows.push({
        ...st,
        currentBets: cur,
        currentTotal: sumBets(cur),
        allIn: this.allIns.has(st.userId),
        lastNet: this.lastNets.get(st.userId) ?? null,
      });
    }
    rows.sort((a, b) => b.wagered - a.wagered || Math.abs(b.net) - Math.abs(a.net));
    return rows.slice(0, 200); // 客户端负责：自己置顶 + 其他前 10 + 折叠
  }

  private emitBets() {
    this.emit('bets', { tableId: this.cfg.id, leaderboard: this.leaderboard() });
  }

  snapshot(): TableSnapshot {
    return {
      id: this.cfg.id,
      name: this.cfg.name,
      kind: this.cfg.kind,
      hallId: this.cfg.hallId,
      phase: this.phase,
      roundId: this.roundId,
      roundNo: this.roundNo,
      shoeId: this.shoeId,
      countdownEndsAt: this.countdownEndsAt, nextRoundAt: this.nextRoundAt,
      playerCards: this.hand.playerCards,
      bankerCards: this.hand.bankerCards,
      playerTotal: this.handTotalOf(this.hand.playerCards),
      bankerTotal: this.handTotalOf(this.hand.bankerCards),
      lastResult: this.lastResult,
      roadmap: this.roadmap,
      limits: { minBet: this.cfg.minBet, maxBet: this.cfg.maxBet, maxSideBet: this.cfg.maxSideBet },
      payouts: this.cfg.payouts,
      stream: this.cfg.stream,
      dealerName: this.cfg.dealerName,
      playersOnline: this.online.size,
      leaderboard: this.leaderboard(),
      serverTime: Date.now(),
    };
  }

  /** 大厅列表用的轻量摘要 */
  summary() {
    const s = this.roadmap.stats;
    return {
      id: this.cfg.id, name: this.cfg.name, kind: this.cfg.kind, hallId: this.cfg.hallId,
      phase: this.phase, roundNo: this.roundNo, countdownEndsAt: this.countdownEndsAt, nextRoundAt: this.nextRoundAt,
      limits: { minBet: this.cfg.minBet, maxBet: this.cfg.maxBet },
      dealerName: this.cfg.dealerName, playersOnline: this.online.size,
      stats: s, recent: this.history.slice(-30), bigRoad: this.roadmap.bigRoad.slice(-12),
    };
  }
}

export function sumBets(b: Bets): number {
  return round2(Object.values(b).reduce((s, v) => s + (v ?? 0), 0));
}

function valueOf(c: Card): number {
  if (c.rank === 'A') return 1;
  if ('TJQK'.includes(c.rank)) return 0;
  return Number(c.rank);
}
