// 公共类型定义（服务端与前端共享的协议形状见 web/src/lib/protocol.ts）

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type Side = 'player' | 'banker';
export type Outcome = 'player' | 'banker' | 'tie';

/** 支持的投注区域 */
export type BetType =
  | 'player'        // 闲
  | 'banker'        // 庄
  | 'tie'           // 和
  | 'playerPair'    // 闲对
  | 'bankerPair'    // 庄对
  | 'anyPair'       // 任意对子
  | 'perfectPair'   // 完美对子（同花同点）
  | 'lucky6'        // 幸运6：庄以 6 点赢
  | 'lucky7'        // 幸运7：庄以 7 点赢（见 payouts.ts 说明）
  | 'big'           // 大：总牌数 5-6 张
  | 'small';        // 小：总牌数 4 张

export const BET_TYPES: BetType[] = [
  'player', 'banker', 'tie', 'playerPair', 'bankerPair', 'anyPair', 'perfectPair',
  'lucky6', 'lucky7', 'big', 'small',
];

export interface HandResult {
  playerCards: Card[];
  bankerCards: Card[];
  playerTotal: number;
  bankerTotal: number;
  outcome: Outcome;
  playerPair: boolean;
  bankerPair: boolean;
  /** 幸运6/7 等边注命中信息 */
  bankerCardCount: number;
  playerCardCount: number;
}

export type TablePhase = 'idle' | 'betting' | 'dealing' | 'settling' | 'shuffling' | 'maintenance';

export type TableKind = 'rng' | 'live';
