/**
 * 牌路（路单）计算
 *
 *  - 珠盘路 (Bead Plate)：按局顺序逐格记录 庄/闲/和 + 对子标记
 *  - 大路 (Big Road)：庄/闲连开成列，和局记在上一格上（开头的和局挂到第一格）
 *  - 大眼仔 / 小路 / 曱甴路：由大路按 offset 1/2/3 推导
 *  - 问路：假设下一局开庄 / 开闲，三条下路会出现的颜色
 *
 * 大路这里存"逻辑列"（不做 6 行折行），折行/龙尾由前端渲染时处理。
 */
import type { Outcome } from './types.js';

export interface RoundSummary {
  outcome: Outcome;
  playerPair: boolean;
  bankerPair: boolean;
}

export interface BigRoadCell {
  outcome: 'player' | 'banker';
  ties: number;
  playerPair: boolean;
  bankerPair: boolean;
}

export type DerivedColor = 'red' | 'blue';

export interface Roadmap {
  bead: RoundSummary[];
  bigRoad: BigRoadCell[][];          // 列 -> 格
  leadingTies: number;               // 大路开局前的和局数
  bigEye: DerivedColor[][];
  small: DerivedColor[][];
  cockroach: DerivedColor[][];
  prediction: {
    banker: { bigEye: DerivedColor | null; small: DerivedColor | null; cockroach: DerivedColor | null };
    player: { bigEye: DerivedColor | null; small: DerivedColor | null; cockroach: DerivedColor | null };
  };
  stats: { rounds: number; banker: number; player: number; tie: number; playerPair: number; bankerPair: number };
}

export function buildBigRoad(rounds: RoundSummary[]): { cols: BigRoadCell[][]; leadingTies: number } {
  const cols: BigRoadCell[][] = [];
  let leadingTies = 0;
  for (const r of rounds) {
    if (r.outcome === 'tie') {
      const last = cols.at(-1)?.at(-1);
      if (last) last.ties++;
      else leadingTies++;
      continue;
    }
    const cell: BigRoadCell = { outcome: r.outcome, ties: 0, playerPair: r.playerPair, bankerPair: r.bankerPair };
    const lastCol = cols.at(-1);
    if (lastCol && lastCol[0].outcome === r.outcome) lastCol.push(cell);
    else cols.push([cell]);
  }
  return { cols, leadingTies };
}

/** 由大路推导下路；offset: 1=大眼仔 2=小路 3=曱甴路 */
export function deriveRoad(bigRoad: BigRoadCell[][], offset: number): DerivedColor[][] {
  const colors: DerivedColor[] = [];
  for (let c = 0; c < bigRoad.length; c++) {
    for (let r = 0; r < bigRoad[c].length; r++) {
      const col = cellColor(bigRoad, c, r, offset);
      if (col) colors.push(col);
    }
  }
  return groupDerived(colors);
}

function cellColor(big: BigRoadCell[][], c: number, r: number, k: number): DerivedColor | null {
  if (r === 0) {
    if (c < k + 1) return null;
    return big[c - 1].length === big[c - 1 - k].length ? 'red' : 'blue';
  }
  if (c < k) return null;
  const ref = big[c - k].length;
  if (ref >= r + 1) return 'red';   // 对应格有子
  if (ref === r) return 'blue';     // 对应列刚好在此处结束
  return 'red';                     // 双方都为空
}

/** 下路同色连开成列 */
function groupDerived(colors: DerivedColor[]): DerivedColor[][] {
  const cols: DerivedColor[][] = [];
  for (const col of colors) {
    const last = cols.at(-1);
    if (last && last[0] === col) last.push(col);
    else cols.push([col]);
  }
  return cols;
}

function predict(bigRoad: BigRoadCell[][], next: 'player' | 'banker') {
  const clone = bigRoad.map((col) => col.slice());
  const cell: BigRoadCell = { outcome: next, ties: 0, playerPair: false, bankerPair: false };
  const lastCol = clone.at(-1);
  let c: number, r: number;
  if (lastCol && lastCol[0].outcome === next) { lastCol.push(cell); c = clone.length - 1; r = lastCol.length - 1; }
  else { clone.push([cell]); c = clone.length - 1; r = 0; }
  return {
    bigEye: cellColor(clone, c, r, 1),
    small: cellColor(clone, c, r, 2),
    cockroach: cellColor(clone, c, r, 3),
  };
}

export function buildRoadmap(rounds: RoundSummary[]): Roadmap {
  const { cols, leadingTies } = buildBigRoad(rounds);
  const stats = { rounds: rounds.length, banker: 0, player: 0, tie: 0, playerPair: 0, bankerPair: 0 };
  for (const r of rounds) {
    stats[r.outcome]++;
    if (r.playerPair) stats.playerPair++;
    if (r.bankerPair) stats.bankerPair++;
  }
  return {
    bead: rounds,
    bigRoad: cols,
    leadingTies,
    bigEye: deriveRoad(cols, 1),
    small: deriveRoad(cols, 2),
    cockroach: deriveRoad(cols, 3),
    prediction: { banker: predict(cols, 'banker'), player: predict(cols, 'player') },
    stats,
  };
}
