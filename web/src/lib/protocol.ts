// 与服务端共享的协议类型（手工镜像 server/src/game/*.ts）

export type Suit = 'S' | 'H' | 'D' | 'C';
export interface Card { rank: string; suit: Suit }
export type Outcome = 'player' | 'banker' | 'tie';
export type BetType =
  | 'player' | 'banker' | 'tie' | 'playerPair' | 'bankerPair' | 'anyPair' | 'perfectPair'
  | 'lucky6' | 'lucky7' | 'big' | 'small';
export type Bets = Partial<Record<BetType, number>>;
export type TablePhase = 'idle' | 'betting' | 'dealing' | 'settling' | 'shuffling' | 'maintenance';

export interface User { id: number; username: string; nickname: string; vipLevel: number; balance: number; role: string }

export interface HandResult {
  playerCards: Card[]; bankerCards: Card[]; playerTotal: number; bankerTotal: number;
  outcome: Outcome; playerPair: boolean; bankerPair: boolean; playerCardCount: number; bankerCardCount: number;
}

export interface RoundSummary { outcome: Outcome; playerPair: boolean; bankerPair: boolean }
export interface BigRoadCell { outcome: 'player' | 'banker'; ties: number; playerPair: boolean; bankerPair: boolean }
export type DerivedColor = 'red' | 'blue';
export interface Roadmap {
  bead: RoundSummary[]; bigRoad: BigRoadCell[][]; leadingTies: number;
  bigEye: DerivedColor[][]; small: DerivedColor[][]; cockroach: DerivedColor[][];
  prediction: Record<'banker' | 'player', { bigEye: DerivedColor | null; small: DerivedColor | null; cockroach: DerivedColor | null }>;
  stats: { rounds: number; banker: number; player: number; tie: number; playerPair: number; bankerPair: number };
}

export interface LeaderboardEntry {
  userId: number; nickname: string; wagered: number; net: number; rounds: number;
  currentBets: Bets; currentTotal: number; allIn: boolean; lastNet: number | null;
}

export interface PayoutTable {
  player: number; banker: number; tie: number; playerPair: number; bankerPair: number; anyPair: number; perfectPair: number;
  lucky6TwoCards: number; lucky6ThreeCards: number; lucky7TwoCards: number; lucky7ThreeCards: number; big: number; small: number;
  noCommission: boolean;
}

export interface TableSnapshot {
  id: string; name: string; kind: 'rng' | 'live'; hallId: string; phase: TablePhase;
  roundId: string | null; roundNo: number; shoeId: string | null; countdownEndsAt: number | null;
  playerCards: Card[]; bankerCards: Card[]; playerTotal: number; bankerTotal: number;
  lastResult: HandResult | null; roadmap: Roadmap;
  limits: { minBet: number; maxBet: number; maxSideBet: number }; payouts: PayoutTable;
  stream?: { whepUrl: string; fallbackHlsUrl?: string }; dealerName?: string;
  playersOnline: number; leaderboard: LeaderboardEntry[]; serverTime: number;
}

export interface TableSummary {
  id: string; name: string; kind: 'rng' | 'live'; hallId: string; phase: TablePhase; roundNo: number;
  countdownEndsAt: number | null; limits: { minBet: number; maxBet: number }; dealerName?: string; playersOnline: number;
  stats: Roadmap['stats']; recent: RoundSummary[]; bigRoad: BigRoadCell[][];
}

export interface Hall { id: string; name: string; kind: 'lobby' | 'vip'; minVipLevel: number; locked: boolean; tables: TableSummary[] }

export const BET_LABELS: Record<BetType, string> = {
  player: '闲', banker: '庄', tie: '和', playerPair: '闲对', bankerPair: '庄对', anyPair: '任意对子',
  perfectPair: '完美对子', lucky6: '幸运6', lucky7: '幸运7', big: '大', small: '小',
};

export function payoutLabel(t: BetType, p: PayoutTable): string {
  switch (t) {
    case 'player': return '1:1';
    case 'banker': return p.noCommission ? '1:1 (6点 1:2)' : `1:${p.banker}`;
    case 'tie': return `1:${p.tie}`;
    case 'playerPair': return `1:${p.playerPair}`;
    case 'bankerPair': return `1:${p.bankerPair}`;
    case 'anyPair': return `1:${p.anyPair}`;
    case 'perfectPair': return `1:${p.perfectPair}`;
    case 'lucky6': return `${p.lucky6TwoCards}/${p.lucky6ThreeCards}`;
    case 'lucky7': return `${p.lucky7TwoCards}/${p.lucky7ThreeCards}`;
    case 'big': return `1:${p.big}`;
    case 'small': return `1:${p.small}`;
  }
}
