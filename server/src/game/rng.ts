/**
 * RNG 牌靴
 *
 * 随机源：Node `crypto.randomInt`（底层为操作系统 CSPRNG：getrandom / BCryptGenRandom），
 * 洗牌：Fisher–Yates，无取模偏差（randomInt 内部做拒绝采样）。
 *
 * 合规说明（GLI-19 / iTech Labs RNG 标准的常见要求）：
 *  - 随机数来源不可预测、不可被玩家影响              -> OS CSPRNG
 *  - 洗牌算法对所有排列均匀                          -> Fisher–Yates + 无偏整数
 *  - 每靴/每局可审计                                 -> 每靴记录 shoeId、seedFingerprint（随机源摘要）、
 *                                                       每张发出的牌顺序（TableService 落库到 rounds 表）
 *  - 认证：正式上线前需将本模块 + 统计测试（chi-square、runs、
 *    serial correlation 等）交由第三方实验室审核，本仓库 test/rng.test.ts 提供基础的分布自检。
 */
import { randomInt, randomBytes, createHash } from 'node:crypto';
import type { Card, Rank, Suit } from './types.js';

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export function buildDecks(deckCount: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
  }
  return cards;
}

/** 无偏 Fisher–Yates 洗牌（就地） */
export function secureShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface ShoeOptions {
  deckCount?: number;      // 默认 8 副
  cutCardFrom?: number;    // 切牌位置：距牌靴末尾还剩多少张时本靴结束（默认 14~20 张之间随机）
  burnFirstCard?: boolean; // 是否按实体赌场惯例烧牌（默认 true）
}

export class Shoe {
  readonly shoeId: string;
  readonly seedFingerprint: string;
  readonly deckCount: number;
  private cards: Card[];
  private pos = 0;
  private readonly cutIndex: number;
  readonly dealtLog: Card[] = [];
  readonly createdAt = Date.now();

  constructor(opts: ShoeOptions = {}) {
    this.deckCount = opts.deckCount ?? 8;
    this.cards = secureShuffle(buildDecks(this.deckCount));
    const entropy = randomBytes(32);
    this.shoeId = entropy.subarray(0, 8).toString('hex');
    // 指纹：洗牌后牌序的哈希，可在事后公布用于公平性验证（provably fair 风格）
    this.seedFingerprint = createHash('sha256')
      .update(this.cards.map((c) => c.rank + c.suit).join(','))
      .digest('hex');
    const remain = opts.cutCardFrom ?? randomInt(14, 21);
    this.cutIndex = this.cards.length - remain;
    if (opts.burnFirstCard ?? true) this.burn();
  }

  /** 烧牌：翻开第一张，按其点数（J/Q/K/T 算 10）再烧掉相应张数 */
  private burn() {
    const first = this.draw();
    const v = cardValue(first, true);
    for (let i = 0; i < v; i++) this.draw();
  }

  get remaining(): number {
    return this.cards.length - this.pos;
  }

  /** 切牌已到达 → 本局结束后需换靴 */
  get needsShuffle(): boolean {
    return this.pos >= this.cutIndex;
  }

  draw(): Card {
    if (this.pos >= this.cards.length) throw new Error('shoe exhausted');
    const c = this.cards[this.pos++];
    this.dealtLog.push(c);
    return c;
  }
}

/** 百家乐点数：A=1，2-9 面值，T/J/Q/K=0（烧牌时 10 点牌按 10 计） */
export function cardValue(card: Card, forBurn = false): number {
  switch (card.rank) {
    case 'A': return 1;
    case 'T': case 'J': case 'Q': case 'K': return forBurn ? 10 : 0;
    default: return Number(card.rank);
  }
}
