import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadmap, buildBigRoad, deriveRoad, type RoundSummary } from '../src/game/roadmap.js';

const seq = (s: string): RoundSummary[] =>
  [...s].map((ch) => ({ outcome: ch === 'B' ? 'banker' : ch === 'P' ? 'player' : 'tie', playerPair: false, bankerPair: false }));

test('大路：同色连开成列，和局挂在上一格', () => {
  const { cols, leadingTies } = buildBigRoad(seq('TBBTPBBB'));
  assert.equal(leadingTies, 1);
  assert.deepEqual(cols.map((c) => c.map((x) => x.outcome[0] + x.ties)), [['b0', 'b1'], ['p0'], ['b0', 'b0', 'b0']]);
});

test('大眼仔：新列首格比较前两列长度', () => {
  // 大路列长：B2, P2, B1 → 第三列首格：前一列(2) vs 前前列(2) 相等 → 红
  const { cols } = buildBigRoad(seq('BBPPB'));
  const eye = deriveRoad(cols, 1);
  assert.deepEqual(eye.flat(), ['red', 'red']); // (col1,row1)：对应 col0 有 row1 → 红；(col2,row0) → 红
});

test('小路 / 曱甴路起始位置', () => {
  const { cols } = buildBigRoad(seq('BPBPBP'));
  assert.equal(deriveRoad(cols, 2).flat().length, 3); // 从第 4 列（index 3）起
  assert.equal(deriveRoad(cols, 3).flat().length, 2); // 从第 5 列起
});

test('问路与统计', () => {
  const rm = buildRoadmap(seq('BBPPBTP'));
  assert.equal(rm.stats.banker, 3);
  assert.equal(rm.stats.player, 3);
  assert.equal(rm.stats.tie, 1);
  assert.ok(rm.prediction.banker.bigEye === 'red' || rm.prediction.banker.bigEye === 'blue');
  assert.ok(rm.prediction.player.bigEye === 'red' || rm.prediction.player.bigEye === 'blue');
});
