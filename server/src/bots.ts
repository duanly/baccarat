/**
 * 托账号（机器人玩家）：分组「tuo」，只在大厅 RNG 桌活动，模拟真人节奏随机下注。
 *
 *  - 账号：用户名 tuo001…，随机中文昵称，users.is_bot=1，自动归入 groups.name='tuo'
 *  - 行为：每个机器人独立"逛桌"——随机挑一张大厅桌坐 5~40 局，离桌休息几分钟再换桌；
 *          不是每局都下（默认 65% 概率），下注时间在投注窗口内随机（开盘 1.5s 后到封盘前 1.5s），
 *          有时分两次追加；注码按桌子限红的筹码梯度随机（小注为主），偏好庄/闲，偶尔和/对子
 *  - 余额：低于下限时自动补分（kind=adjust, note='bot topup'），不会因为输光而停摆
 *  - 每桌机器人上限（默认 5），永远给真人留位
 *  - 后台：GET/PATCH /api/admin/bots 开关、数量、每桌上限、下注概率；设置持久化在 kv 表
 */
import type { DB } from './db/index.js';
import type { Wallet } from './wallet.js';
import type { TableManager } from './game/manager.js';
import type { BaccaratTable, Bets } from './game/table.js';
import type { BetType } from './game/types.js';
import { randomBytes, scryptSync } from 'node:crypto';

export interface BotSettings {
  enabled: boolean;
  count: number;          // 机器人总数（账号数量，可只启用其中一部分）
  maxPerTable: number;    // 每桌最多几个机器人
  betChance: number;      // 每局下注概率 0~1
  minBalance: number;     // 余额低于此值自动补到 topup
  topup: number;
}
const DEFAULTS: BotSettings = { enabled: false, count: 30, maxPerTable: 5, betChance: 0.65, minBalance: 2000, topup: 20000 };

const SURNAMES = '王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文';
const NICK_TAIL = ['哥', '姐', '总', '少', '爷', '叔', '老板', '先生', '小姐', '大师', '一号', '发财', '必胜', '常胜', '来了', '在线', '很稳', '不慌', '梭哈', '追庄', '看路', '随缘', '佛系', '躺赢', '上岸'];
const NICK_PLAIN = ['阿', '老', '小', '大'];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
function nickname(): string {
  const s = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
  const r = Math.random();
  if (r < 0.35) return pick(NICK_PLAIN) + s;
  if (r < 0.75) return s + pick(NICK_TAIL);
  if (r < 0.9) return s + '先生';
  return pick(['财神', '锦鲤', '欧皇', '夜猫', '晨风', '海风', '清风', '流年', '星辰', '大海', '山河', '木子', '西西', '多多', '果果']) + pick(['', '', '888', '666', '520', '1314']);
}

interface BotState {
  userId: number;
  nickname: string;
  tableId: string | null;
  roundsLeft: number;
  restUntil: number;
  betTimers: ReturnType<typeof setTimeout>[];
  lastRound: string | null;
  style: 'banker' | 'player' | 'mixed' | 'follow';   // 偏好：追庄 / 追闲 / 混合 / 跟路
  sizing: number;                                     // 注码偏好 0.3(小) ~ 1(敢压)
}

export class BotService {
  private settings: BotSettings;
  private bots = new Map<number, BotState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private groupId = 0;

  constructor(private db: DB, private wallet: Wallet, private tables: TableManager) {
    this.settings = { ...DEFAULTS, ...this.loadSettings() };
    this.ensureGroup();
  }

  // ---------- 设置持久化 ----------
  private loadSettings(): Partial<BotSettings> {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = 'bots'").get() as any;
    try { return row ? JSON.parse(row.value) : {}; } catch { return {}; }
  }
  private saveSettings() {
    this.db.prepare("INSERT INTO kv (key, value) VALUES ('bots', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(this.settings));
  }
  get config(): BotSettings { return { ...this.settings }; }

  update(patch: Partial<BotSettings>): BotSettings {
    const s = { ...this.settings };
    if (patch.enabled !== undefined) s.enabled = !!patch.enabled;
    if (patch.count !== undefined) s.count = clamp(Number(patch.count), 0, 200);
    if (patch.maxPerTable !== undefined) s.maxPerTable = clamp(Number(patch.maxPerTable), 0, 10);
    if (patch.betChance !== undefined) s.betChance = clamp(Number(patch.betChance), 0, 1);
    if (patch.minBalance !== undefined) s.minBalance = clamp(Number(patch.minBalance), 0, 1e7);
    if (patch.topup !== undefined) s.topup = clamp(Number(patch.topup), 0, 1e8);
    const restart = s.count !== this.settings.count || s.enabled !== this.settings.enabled;
    this.settings = s;
    this.saveSettings();
    this.ensureAccounts(s.count);
    if (restart) { this.stop(); if (s.enabled) this.start(); }
    return this.config;
  }

  // ---------- 账号 ----------
  private ensureGroup() {
    const row = this.db.prepare("SELECT id FROM groups WHERE name = 'tuo'").get() as any;
    if (row) { this.groupId = row.id; return; }
    const r = this.db.prepare("INSERT INTO groups (name, note, created_at) VALUES ('tuo', '托账号（机器人）', ?)").run(Date.now());
    this.groupId = Number(r.lastInsertRowid);
  }

  /** 保证至少有 n 个机器人账号（多出来的保留不删，只是不启用） */
  ensureAccounts(n: number) {
    const have = (this.db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_bot = 1').get() as any).c as number;
    for (let i = have; i < n; i++) {
      const username = `tuo${String(i + 1).padStart(3, '0')}`;
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(randomBytes(12).toString('hex'), salt, 64).toString('hex');   // 随机密码，不能登录
      const balance = Math.round(rnd(this.settings.topup * 0.4, this.settings.topup * 1.6) / 100) * 100;
      const now = Date.now() - Math.floor(rnd(1, 40) * 86400e3);   // 注册时间打散在过去 40 天
      try {
        const r = this.db.prepare('INSERT INTO users (username, password_hash, salt, nickname, balance, created_at, group_id, is_bot) VALUES (?,?,?,?,?,?,?,1)')
          .run(username, hash, salt, nickname(), balance, now, this.groupId);
        this.db.prepare('INSERT INTO transactions (user_id, kind, amount, balance, ref, note, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(Number(r.lastInsertRowid), 'deposit', balance, balance, 'bot', 'bot init', now);
      } catch { /* 用户名已存在（历史遗留）：跳过 */ }
    }
  }

  private accounts(limit: number): { id: number; nickname: string }[] {
    return this.db.prepare('SELECT id, nickname FROM users WHERE is_bot = 1 AND status = ? ORDER BY id LIMIT ?').all('active', limit) as any;
  }

  // ---------- 生命周期 ----------
  start() {
    if (this.timer) return;
    this.ensureAccounts(this.settings.count);
    for (const a of this.accounts(this.settings.count)) {
      if (this.bots.has(a.id)) continue;
      this.bots.set(a.id, {
        userId: a.id, nickname: a.nickname, tableId: null, roundsLeft: 0,
        restUntil: Date.now() + rnd(0, 90e3),   // 启动后 0~90s 内陆续进桌，不要一起涌入
        betTimers: [], lastRound: null,
        style: pick(['banker', 'banker', 'player', 'mixed', 'mixed', 'follow']),
        sizing: rnd(0.3, 1),
      });
    }
    this.wireTables();
    this.timer = setInterval(() => this.tick(), 2000);
    this.timer.unref?.();
    console.log(`bots: started ${this.bots.size} 个托账号`);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const b of this.bots.values()) this.sitOut(b);
    if (this.bots.size) console.log('bots: stopped');
    this.bots.clear();
  }

  status() {
    const perTable: Record<string, number> = {};
    for (const b of this.bots.values()) if (b.tableId) perTable[b.tableId] = (perTable[b.tableId] ?? 0) + 1;
    return { ...this.config, running: !!this.timer, active: this.bots.size, seated: Object.values(perTable).reduce((a, c) => a + c, 0), perTable };
  }

  private wired = new Set<string>();
  private hooked = false;
  private wireTables() {
    if (this.hooked) return;
    this.hooked = true;
    const hook = (t: BaccaratTable) => {
      if (this.wired.has(t.cfg.id)) return;
      this.wired.add(t.cfg.id);
      t.on('state', (snap) => { if (snap.phase === 'betting') this.onBettingOpen(t); });
      t.on('result', () => { for (const b of this.bots.values()) if (b.tableId === t.cfg.id) b.roundsLeft--; });
    };
    for (const t of this.tables.tables.values()) hook(t);
    this.tables.onAdd(hook);
  }

  /** 只在大厅（RNG 桌、非私人房、非 VIP）活动 */
  private lobbyTables(): BaccaratTable[] {
    return [...this.tables.tables.values()].filter((t) => {
      if (t.cfg.kind !== 'rng' || t.cfg.hallId === 'private') return false;
      const hall = this.tables.hallOf(t.cfg.id);
      return !hall || hall.minVipLevel === 0;
    });
  }

  private countAt(tableId: string) { let n = 0; for (const b of this.bots.values()) if (b.tableId === tableId) n++; return n; }

  private tick() {
    const now = Date.now();
    for (const b of this.bots.values()) {
      if (b.tableId) {
        if (b.roundsLeft <= 0) { this.sitOut(b); b.restUntil = now + rnd(60e3, 8 * 60e3); }
        continue;
      }
      if (now < b.restUntil) continue;
      this.sitIn(b);
    }
  }

  private sitIn(b: BotState) {
    const candidates = this.lobbyTables().filter((t) => !t.isFull && this.countAt(t.cfg.id) < this.settings.maxPerTable && t.onlineCount < t.cfg.capacity - 2);
    if (!candidates.length) { b.restUntil = Date.now() + 30e3; return; }
    // 偏向已经有人的桌（真人喜欢热闹），但也会去空桌
    const weighted = candidates.flatMap((t) => Array(1 + Math.min(4, t.onlineCount)).fill(t) as BaccaratTable[]);
    const t = pick(weighted);
    try { t.join(b.userId, b.nickname); } catch { b.restUntil = Date.now() + 15e3; return; }
    b.tableId = t.cfg.id;
    b.roundsLeft = Math.floor(rnd(5, 40));
    // 正好在投注中进桌：也可能立刻参与
    if (t.phase === 'betting') this.onBettingOpen(t);
  }

  private sitOut(b: BotState) {
    for (const x of b.betTimers) clearTimeout(x);
    b.betTimers = [];
    if (b.tableId) { try { this.tables.tables.get(b.tableId)?.leave(b.userId); } catch { /* ignore */ } }
    b.tableId = null;
  }

  private onBettingOpen(t: BaccaratTable) {
    const endsAt = t.countdownEndsAt ?? Date.now() + t.cfg.bettingSeconds * 1000;
    for (const b of this.bots.values()) {
      if (b.tableId !== t.cfg.id || b.lastRound === t.roundId) continue;
      b.lastRound = t.roundId;
      if (Math.random() > this.settings.betChance) continue;
      const window = endsAt - Date.now() - 1500;
      if (window < 2000) continue;
      // 第一次下注：窗口内随机（前段略密），30% 再追加一次
      const first = 1500 + Math.random() ** 1.3 * window;
      b.betTimers.push(setTimeout(() => this.placeBet(b, t), first));
      if (Math.random() < 0.3) {
        const second = first + rnd(1200, Math.max(1300, window - first));
        if (second < window + 1500) b.betTimers.push(setTimeout(() => this.placeBet(b, t), second));
      }
    }
  }

  private placeBet(b: BotState, t: BaccaratTable) {
    if (b.tableId !== t.cfg.id || t.phase !== 'betting') return;
    this.topupIfNeeded(b);
    const bets = this.chooseBets(b, t);
    try { t.placeBets(b.userId, b.nickname, bets); } catch { /* 封盘等：忽略 */ }
  }

  private topupIfNeeded(b: BotState) {
    const bal = this.wallet.balance(b.userId);
    if (bal < this.settings.minBalance) {
      const amt = Math.round(rnd(this.settings.topup * 0.6, this.settings.topup * 1.4) / 100) * 100;
      try { this.wallet.apply(b.userId, 'adjust', amt, 'bot', { note: 'bot topup' }); } catch { /* ignore */ }
    }
  }

  private chooseBets(b: BotState, t: BaccaratTable): Bets {
    const { minBet, maxBet, maxSideBet } = t.cfg;
    const ladder = chipLadder(minBet, maxBet);
    // 注码：sizing 越大越敢压；整体偏小注
    const idx = Math.min(ladder.length - 1, Math.floor(Math.random() ** (2 - b.sizing) * ladder.length));
    let main = ladder[idx] * (Math.random() < 0.25 ? Math.floor(rnd(2, 5)) : 1);
    main = Math.min(main, maxBet);
    const bal = this.wallet.balance(b.userId);
    if (main > bal * 0.5) main = Math.max(minBet, Math.floor(bal * 0.2 / minBet) * minBet);
    if (main < minBet) main = minBet;

    let side: BetType;
    const r = Math.random();
    if (b.style === 'banker') side = r < 0.8 ? 'banker' : 'player';
    else if (b.style === 'player') side = r < 0.8 ? 'player' : 'banker';
    else if (b.style === 'follow') side = this.followRoad(t) ?? (r < 0.5 ? 'banker' : 'player');
    else side = r < 0.52 ? 'banker' : 'player';
    const bets: Bets = { [side]: main };
    // 偶尔加一手和 / 对子（小注，受边注上限约束）
    const sideAmt = Math.min(ladder[0] * (Math.random() < 0.7 ? 1 : 2), maxSideBet);
    const s = Math.random();
    if (s < 0.08) bets.tie = sideAmt;
    else if (s < 0.14) bets[pick(['playerPair', 'bankerPair', 'anyPair'] as const)] = sideAmt;
    else if (s < 0.17) bets[pick(['big', 'small'] as const)] = sideAmt;
    return bets;
  }

  /** 跟路：连续同一方赢就跟，否则反 */
  private followRoad(t: BaccaratTable): BetType | null {
    const last = t.recentOutcomes(3);
    if (last.length < 2) return null;
    const a = last[last.length - 1], bb = last[last.length - 2];
    if (a === 'tie') return null;
    if (a === bb) return a === 'banker' || a === 'player' ? a : null;
    return a === 'banker' ? 'player' : a === 'player' ? 'banker' : null;
  }
}

function clamp(n: number, lo: number, hi: number) { return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }

/** 与前端 chips.ts 一致的 1-2-5 筹码梯度（取 5~6 档） */
function chipLadder(minBet: number, maxBet: number): number[] {
  const out: number[] = [];
  let base = Math.pow(10, Math.floor(Math.log10(Math.max(1, minBet))));
  const seq = [1, 2, 5];
  for (let mag = base; mag <= maxBet && out.length < 6; mag *= 10) {
    for (const m of seq) { const v = mag * m; if (v >= minBet && v <= maxBet) out.push(v); }
  }
  return out.length ? out : [minBet];
}
