import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hand, bankerDrawsAfterPlayerThird, dealHand, handTotal } from '../src/game/rules.js';
import { settleBets, DEFAULT_PAYOUTS, NO_COMMISSION_PAYOUTS } from '../src/game/payouts.js';
import { Shoe } from '../src/game/rng.js';
import type { Card } from '../src/game/types.js';

const c = (s: string): Card => ({ rank: s[0] as any, suit: s[1] as any });
const feedAll = (cards: string[]) => { const h = new Hand(); for (const x of cards) h.feed(c(x)); return h; };

test('点数计算', () => {
  assert.equal(handTotal([c('KS'), c('9H')]), 9);
  assert.equal(handTotal([c('7S'), c('8H')]), 5);
  assert.equal(handTotal([c('AS'), c('TS')]), 1);
});

test('天牌停牌', () => {
  const h = feedAll(['9S', '2H', 'KS', '3D']); // 闲 9 vs 庄 5
  assert.equal(h.complete, true);
  assert.equal(h.result().outcome, 'player');
});

test('闲家 0-5 补牌，庄家按补牌表', () => {
  const h = feedAll(['2S', '3H', '3S', '4D']); // 闲 5, 庄 7
  assert.equal(h.nextTarget(), 'player');
  h.feed(c('8C')); // 闲第三张 8 → 闲 3；庄 7 停牌
  assert.equal(h.complete, true);
  assert.equal(h.result().outcome, 'banker');
});

test('庄家补牌表', () => {
  assert.equal(bankerDrawsAfterPlayerThird(3, 8), false);
  assert.equal(bankerDrawsAfterPlayerThird(3, 7), true);
  assert.equal(bankerDrawsAfterPlayerThird(4, 1), false);
  assert.equal(bankerDrawsAfterPlayerThird(4, 2), true);
  assert.equal(bankerDrawsAfterPlayerThird(5, 3), false);
  assert.equal(bankerDrawsAfterPlayerThird(5, 4), true);
  assert.equal(bankerDrawsAfterPlayerThird(6, 5), false);
  assert.equal(bankerDrawsAfterPlayerThird(6, 6), true);
  assert.equal(bankerDrawsAfterPlayerThird(7, 6), false);
});

test('闲家停牌时庄家 0-5 补牌', () => {
  const h = feedAll(['3S', '2H', '3S', '3D']); // 闲 6 停，庄 5 补
  assert.equal(h.nextTarget(), 'banker');
  h.feed(c('2C'));
  assert.equal(h.result().bankerTotal, 7);
  assert.equal(h.result().outcome, 'banker');
});

test('结算：庄赢抽水 / 免佣 6 点半赔 / 和局退主注', () => {
  const r = feedAll(['3S', '4H', '3D', '2C']).result(); // 闲 6 vs 庄 6 → 和
  assert.equal(r.outcome, 'tie');
  const s = settleBets({ player: 100, tie: 10, banker: 50 }, r, DEFAULT_PAYOUTS);
  const by = Object.fromEntries(s.map((x) => [x.type, x]));
  assert.equal(by.player.returned, 100); // 退本金
  assert.equal(by.tie.returned, 90);     // 8:1 + 本金
  assert.equal(by.banker.returned, 50);
});

test('幸运6 / 幸运7 / 对子 / 大小', () => {
  // 闲 K+9=9 天牌？ 用闲 7 停，庄 6 停 → 庄以 6 点两张赢
  const r = feedAll(['3S', '4H', '4D', '2C']).result(); // 闲 7, 庄 6 → 闲赢，不行
  assert.equal(r.outcome, 'player');
  const r2 = feedAll(['2S', '4H', '4D', '2C']).result(); // 闲 6 停, 庄 6 停 → 和
  assert.equal(r2.outcome, 'tie');
  // 闲 5 补第三张 K → 闲 5；庄 6 且闲三 0 → 庄停 → 庄以 6 点两张赢
  const h = feedAll(['2S', '4H', '3D', '2C', 'KS']);
  const res = h.result();
  assert.equal(res.outcome, 'banker');
  assert.equal(res.bankerTotal, 6);
  const s = settleBets({ lucky6: 10, banker: 100, small: 10, big: 10 }, res, NO_COMMISSION_PAYOUTS);
  const by = Object.fromEntries(s.map((x) => [x.type, x]));
  assert.equal(by.lucky6.returned, 130);   // 12:1 两张
  assert.equal(by.banker.returned, 150);   // 免佣 6 点赔一半
  assert.equal(by.big.returned, 15.4);     // 5 张牌 → 大
  assert.equal(by.small.returned, 0);

  const r7 = feedAll(['2S', '4H', '4D', '3C']); // 闲 6 停, 庄 7 停 → 庄 7 两张
  const s7 = settleBets({ lucky7: 10, playerPair: 5 }, r7.result(), DEFAULT_PAYOUTS);
  assert.equal(s7.find((x) => x.type === 'lucky7')!.returned, 70);
  assert.equal(s7.find((x) => x.type === 'playerPair')!.returned, 0);

  const pp = feedAll(['9S', '4H', '9H', '3C']).result();
  assert.equal(pp.playerPair, true);
  assert.equal(settleBets({ playerPair: 10, anyPair: 10 }, pp)[0].returned, 120);
});

test('随机发牌 10000 局无异常且庄闲和比例合理', () => {
  const counts = { player: 0, banker: 0, tie: 0 };
  let shoe = new Shoe();
  for (let i = 0; i < 10000; i++) {
    if (shoe.needsShuffle) shoe = new Shoe();
    counts[dealHand(() => shoe.draw()).result().outcome]++;
  }
  assert.ok(counts.banker / 10000 > 0.42 && counts.banker / 10000 < 0.5, JSON.stringify(counts));
  assert.ok(counts.tie / 10000 > 0.06 && counts.tie / 10000 < 0.13, JSON.stringify(counts));
});

