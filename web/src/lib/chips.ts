/**
 * 筹码面额：按牌桌限红自动生成，不同桌子筹码不同。
 *
 * 规则：从最低注开始，沿 1-2-5 阶梯往上取到不超过最高注；超过 6 枚时先去掉 "2" 档（只留 1-5），仍超过则取前 6 枚。
 *   限红 50 – 20,000     →  50 / 100 / 500 / 1K / 5K / 10K
 *   限红 10 – 5,000      →  10 / 50 / 100 / 500 / 1K / 5K
 *   限红 200 – 100,000   →  200 / 500 / 1K / 5K / 10K / 50K
 *   限红 100 – 200,000   →  100 / 500 / 1K / 5K / 10K / 50K
 * 同一面额在所有桌子上颜色固定（50 永远是绿色、100 永远是红色…），玩家换桌不用重新认筹码。
 */
const LADDER_125 = [1, 2, 5];

function ladder(min: number, max: number, steps: number[]): number[] {
  const out: number[] = [];
  for (let base = 1; base <= max; base *= 10) {
    for (const s of steps) {
      const v = base * s;
      if (v >= min && v <= max) out.push(v);
    }
  }
  return out;
}

export function chipSetFor(minBet: number, maxBet: number): number[] {
  const min = Math.max(1, Math.floor(minBet || 1));
  const max = Math.max(min, Math.floor(maxBet || min));
  let vals = ladder(min, max, LADDER_125);
  if (vals.length > 6) vals = ladder(min, max, [1, 5]);
  if (vals.length > 6) vals = vals.slice(0, 6);
  if (vals[0] !== min && (vals.length < 6 || vals[0] > min)) vals = [min, ...vals.filter((v) => v > min)].slice(0, 6);   // 最低注不在阶梯上（如 30）：直接当最小筹码
  if (!vals.length) vals = [min];
  return vals;
}

/** 当前桌的筹码面额（进桌时设置；ChipStack / 飞筹码动画拆分金额时使用） */
let current: number[] = [10, 50, 100, 500, 1000, 5000];
export const setChipSet = (v: number[]) => { current = [...v].sort((a, b) => a - b); };
export const chipSet = () => current;
export const chipSetDesc = () => [...current].sort((a, b) => b - a);

export const chipLabel = (v: number) => (v >= 1000 ? `${v / 1000}K` : String(v));

/** 金额 → 筹码列表（大面额优先，最多 n 枚，零头补一枚最小筹码） */
export function splitAmount(amount: number, n: number): number[] {
  const out: number[] = [];
  let rest = Math.floor(amount);
  for (const v of chipSetDesc()) while (rest >= v && out.length < n) { out.push(v); rest -= v; }
  if (out.length === 0 || (rest > 0 && out.length < n)) out.push(current[0]);
  return out;
}
