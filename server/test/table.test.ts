import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { AuthService } from '../src/auth.js';
import { Wallet } from '../src/wallet.js';
import { TableManager, SqlitePersistence } from '../src/game/manager.js';

function setup() {
  const db = openDb(':memory:');
  const auth = new AuthService(db, { jwtSecret: 's', tokenTtlSec: 60, signupBonus: 1000 });
  const wallet = new Wallet(db);
  const tables = new TableManager(wallet, new SqlitePersistence(db));
  return { db, auth, wallet, tables };
}

test('注册 / 登录 / JWT', () => {
  const { auth } = setup();
  const u = auth.register('alice', 'secret1', 'Alice');
  assert.equal(u.balance, 1000);
  const { token } = auth.login('alice', 'secret1');
  assert.equal(auth.authenticate(token)?.id, u.id);
  assert.throws(() => auth.login('alice', 'wrong'));
  assert.throws(() => auth.register('alice', 'secret1'));
});

test('实况桌：荷官喂牌全流程 + 排行榜按流水排序', () => {
  const { auth, wallet, tables } = setup();
  const a = auth.register('alpha', 'secret1', 'A');
  const b = auth.register('bravo', 'secret1', 'B');
  const t = tables.addTable({ id: 'v1', name: 'v', kind: 'live', hallId: 'vip', bettingSeconds: 60, resultPauseSeconds: 0 });
  t.start();
  assert.equal(t.phase, 'idle');

  t.openBetting();
  t.join(a.id, 'A'); t.join(b.id, 'B');
  t.placeBets(a.id, 'A', { banker: 100, bankerPair: 10 });
  t.placeBets(b.id, 'B', { player: 300 });
  assert.equal(wallet.balance(a.id), 890);
  assert.throws(() => t.placeBets(a.id, 'A', { player: 10 }), /庄闲/);

  // 闲 3+4=7 停；庄 4+2=6 停 → 庄输
  assert.deepEqual(t.dealerCard({ rank: '3', suit: 'S' }), { side: 'player', complete: false });
  assert.equal(t.phase, 'dealing');
  t.dealerCard({ rank: '4', suit: 'H' });
  t.dealerCard({ rank: '4', suit: 'D' });
  const last = t.dealerCard({ rank: '2', suit: 'C' });
  assert.equal(last.complete, true);
  assert.equal(t.phase, 'settling');
  assert.equal(wallet.balance(a.id), 890);   // 全输
  assert.equal(wallet.balance(b.id), 1300);  // 1:1

  const lb = t.leaderboard();
  assert.equal(lb[0].userId, b.id);          // 流水 300 > 110
  assert.equal(lb[0].net, 300);
  assert.equal(lb[1].net, -110);
  assert.equal(t.snapshot().roadmap.stats.player, 1);
  t.stop();
});

test('RNG 桌：自动开局并可下注，超限红拒绝', async () => {
  const { auth, tables } = setup();
  const u = auth.register('charlie', 'secret1', 'C');
  const t = tables.addTable({ id: 'r1', name: 'r', kind: 'rng', hallId: 'lobby', bettingSeconds: 1, resultPauseSeconds: 0, dealIntervalMs: 1, maxBet: 500 });
  t.start();
  assert.equal(t.phase, 'betting');
  assert.throws(() => t.placeBets(u.id, 'C', { banker: 600 }), /限红/);
  t.placeBets(u.id, 'C', { banker: 100 });
  await new Promise((r) => t.once('result', r));
  assert.ok(t.snapshot().lastResult);
  assert.equal(t.snapshot().roadmap.stats.rounds, 1);
  t.stop();
});

test('余额不足时自动梭哈（ALL IN）', () => {
  const { auth, wallet, tables } = setup();
  const u = auth.register('delta', 'secret1', 'D'); // 余额 1000
  const t = tables.addTable({ id: 'v2', name: 'v', kind: 'live', hallId: 'vip', bettingSeconds: 60, maxBet: 100000 });
  t.start(); t.openBetting(); t.join(u.id, 'D');
  const r = t.placeBets(u.id, 'D', { banker: 5000, bankerPair: 100 });
  assert.equal(r.allIn, true);
  assert.deepEqual(r.bets, { banker: 1000 });      // 只够压 1000，后面的对子压不上
  assert.equal(r.balance, 0);
  assert.equal(wallet.balance(u.id), 0);
  assert.equal(t.leaderboard()[0].allIn, true);
  assert.throws(() => t.placeBets(u.id, 'D', { tie: 10 }), /余额不足/);
  t.stop();
});
