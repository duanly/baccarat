/**
 * 百家乐规则引擎（Punto Banco 标准补牌规则）
 *
 * 设计成"喂牌"式状态机：调用方按 nextTarget() 指示逐张提供牌。
 *  - 大厅 RNG 桌：TableService 从 Shoe 抽牌喂入
 *  - VIP 实况桌：荷官端（RFID 读卡器 / 摄像头识别）通过 API 推送每张牌，
 *    引擎负责校验这张牌应该落在闲家还是庄家，并判定是否需要补牌
 */
import type { Card, HandResult, Outcome, Side } from './types.js';
import { cardValue } from './rng.js';

export function handTotal(cards: Card[]): number {
  return cards.reduce((s, c) => s + cardValue(c), 0) % 10;
}

export class Hand {
  playerCards: Card[] = [];
  bankerCards: Card[] = [];

  /** 下一张牌应发给谁；null 表示本局发牌结束 */
  nextTarget(): Side | null {
    const p = this.playerCards.length;
    const b = this.bankerCards.length;
    // 前四张：闲、庄、闲、庄
    if (p === 0) return 'player';
    if (b === 0) return 'banker';
    if (p === 1) return 'player';
    if (b === 1) return 'banker';

    const pt = handTotal(this.playerCards);
    const bt = handTotal(this.bankerCards);
    // 天牌：任一方 8/9 点，停牌
    if (pt >= 8 || bt >= 8) return null;

    // 闲家规则：0-5 补牌，6-7 停牌
    if (p === 2) {
      if (pt <= 5) return 'player';
      // 闲家停牌 → 庄家 0-5 补牌，6-7 停牌
      return b === 2 && bt <= 5 ? 'banker' : null;
    }
    // 闲家已补第三张 → 庄家依据闲家第三张决定
    if (b === 2) {
      const third = cardValue(this.playerCards[2]);
      if (bankerDrawsAfterPlayerThird(bt, third)) return 'banker';
    }
    return null;
  }

  /** 庄家补牌表（闲家已拿第三张时） */
  static bankerDraws = bankerDrawsAfterPlayerThird;

  feed(card: Card): Side {
    const t = this.nextTarget();
    if (!t) throw new Error('hand already complete');
    (t === 'player' ? this.playerCards : this.bankerCards).push(card);
    return t;
  }

  get complete(): boolean {
    return this.nextTarget() === null;
  }

  result(): HandResult {
    if (!this.complete) throw new Error('hand not complete');
    const playerTotal = handTotal(this.playerCards);
    const bankerTotal = handTotal(this.bankerCards);
    const outcome: Outcome =
      playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie';
    return {
      playerCards: this.playerCards,
      bankerCards: this.bankerCards,
      playerTotal,
      bankerTotal,
      outcome,
      playerPair: this.playerCards[0].rank === this.playerCards[1].rank,
      bankerPair: this.bankerCards[0].rank === this.bankerCards[1].rank,
      playerCardCount: this.playerCards.length,
      bankerCardCount: this.bankerCards.length,
    };
  }
}

export function bankerDrawsAfterPlayerThird(bankerTotal: number, playerThird: number): boolean {
  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return playerThird !== 8;
  if (bankerTotal === 4) return playerThird >= 2 && playerThird <= 7;
  if (bankerTotal === 5) return playerThird >= 4 && playerThird <= 7;
  if (bankerTotal === 6) return playerThird === 6 || playerThird === 7;
  return false; // 7 停牌
}

/** 便捷函数：从抽牌源一次性发完一局（RNG 桌用） */
export function dealHand(draw: () => Card): Hand {
  const h = new Hand();
  while (!h.complete) h.feed(draw());
  return h;
}
