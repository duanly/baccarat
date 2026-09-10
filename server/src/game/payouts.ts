/**
 * 赔付表与结算
 *
 * 赔率写法：净赔付倍数（赢 1 单位注码得到多少净利润）。
 * 结算返回 "返还金额" = 本金 + 净利润（输则 0，和局退本金）。
 *
 * 默认为常见亚洲真人厅赔率，可按桌配置覆盖（TableConfig.payouts）。
 *
 * 关于"幸运7"：行业里没有统一定义，这里采用与幸运6对称的定义：
 *   庄家以 7 点获胜 —— 2 张牌 6:1，3 张牌 15:1（可在配置中修改）。
 *   若你实际指的是别的玩法（例如"闲/庄任意一方 7 点赢"），只需改 evaluate 中的 lucky7 分支。
 */
import type { BetType, HandResult } from './types.js';

export interface PayoutTable {
  player: number;
  banker: number;            // 传统抽水 0.95；若用"免佣"模式，把 banker 设 1 并开启 noCommission
  tie: number;
  playerPair: number;
  bankerPair: number;
  anyPair: number;
  perfectPair: number;
  lucky6TwoCards: number;
  lucky6ThreeCards: number;
  lucky7TwoCards: number;
  lucky7ThreeCards: number;
  big: number;
  small: number;
  /** 免佣百家乐：庄家 6 点赢只赔一半 */
  noCommission: boolean;
}

export const DEFAULT_PAYOUTS: PayoutTable = {
  player: 1,
  banker: 0.95,
  tie: 8,
  playerPair: 11,
  bankerPair: 11,
  anyPair: 5,
  perfectPair: 25,
  lucky6TwoCards: 12,
  lucky6ThreeCards: 20,
  lucky7TwoCards: 6,
  lucky7ThreeCards: 15,
  big: 0.54,
  small: 1.5,
  noCommission: false,
};

export const NO_COMMISSION_PAYOUTS: PayoutTable = {
  ...DEFAULT_PAYOUTS,
  banker: 1,
  noCommission: true,
};

/** 一个投注区的结算结果：returned = 本金 + 净利润（0 = 全输） */
export interface BetSettlement {
  type: BetType;
  amount: number;
  returned: number;
  net: number; // returned - amount
}

function isPerfectPair(cards: HandResult['playerCards']): boolean {
  return cards[0].rank === cards[1].rank && cards[0].suit === cards[1].suit;
}

/** 单一投注区的净赔率；返回 null 表示输，0 表示退本金（push） */
export function multiplier(type: BetType, r: HandResult, p: PayoutTable): number | null {
  const totalCards = r.playerCardCount + r.bankerCardCount;
  switch (type) {
    case 'player':
      if (r.outcome === 'player') return p.player;
      return r.outcome === 'tie' ? 0 : null;
    case 'banker':
      if (r.outcome === 'banker') {
        if (p.noCommission && r.bankerTotal === 6) return 0.5;
        return p.banker;
      }
      return r.outcome === 'tie' ? 0 : null;
    case 'tie':
      return r.outcome === 'tie' ? p.tie : null;
    case 'playerPair':
      return r.playerPair ? p.playerPair : null;
    case 'bankerPair':
      return r.bankerPair ? p.bankerPair : null;
    case 'anyPair':
      return r.playerPair || r.bankerPair ? p.anyPair : null;
    case 'perfectPair':
      return isPerfectPair(r.playerCards) || isPerfectPair(r.bankerCards) ? p.perfectPair : null;
    case 'lucky6':
      if (r.outcome === 'banker' && r.bankerTotal === 6)
        return r.bankerCardCount === 3 ? p.lucky6ThreeCards : p.lucky6TwoCards;
      return null;
    case 'lucky7':
      if (r.outcome === 'banker' && r.bankerTotal === 7)
        return r.bankerCardCount === 3 ? p.lucky7ThreeCards : p.lucky7TwoCards;
      return null;
    case 'big':
      return totalCards >= 5 ? p.big : null;
    case 'small':
      return totalCards === 4 ? p.small : null;
  }
}

export function settleBets(
  bets: Partial<Record<BetType, number>>,
  result: HandResult,
  payouts: PayoutTable = DEFAULT_PAYOUTS,
): BetSettlement[] {
  const out: BetSettlement[] = [];
  for (const [type, amount] of Object.entries(bets) as [BetType, number][]) {
    if (!amount) continue;
    const m = multiplier(type, result, payouts);
    const returned = m === null ? 0 : round2(amount + amount * m);
    out.push({ type, amount, returned, net: round2(returned - amount) });
  }
  return out;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
