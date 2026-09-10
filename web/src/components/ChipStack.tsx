/**
 * 筹码堆叠：把金额拆成筹码面额后逐枚向上堆叠。
 *  - ghost：未确认（虚化、虚线边、轻微呼吸动画）
 *  - others：其他玩家的筹码（更小、偏移放置）
 */
export const CHIP_VALUES = [5000, 1000, 500, 100, 50, 10] as const;
export type ChipValue = (typeof CHIP_VALUES)[number];

export function chipClass(v: number): string {
  return `c${v}`;
}

/** 金额 → 筹码列表（大面额优先，最多 maxChips 枚，超出部分合并进最大面额） */
export function splitChips(amount: number, maxChips = 8): number[] {
  const out: number[] = [];
  let rest = Math.floor(amount);
  for (const v of CHIP_VALUES) {
    while (rest >= v && out.length < maxChips) { out.push(v); rest -= v; }
  }
  if (rest > 0 && out.length < maxChips) out.push(10); // 零头补一枚最小筹码示意
  return out;
}

export function ChipStack({ amount, ghost, size = 22, others, label }: {
  amount: number; ghost?: boolean; size?: number; others?: boolean; label?: string;
}) {
  if (!(amount > 0)) return null;
  const chips = splitChips(amount, others ? 5 : 8).reverse(); // 小面额在下、大面额在上，顶部标签显示最大面额
  const step = Math.max(2, Math.round(size * 0.16));
  return (
    <div className={`stack ${ghost ? 'ghost' : ''} ${others ? 'others' : ''}`} style={{ width: size, height: size + step * (chips.length - 1) }}>
      {chips.map((v, i) => (
        <span key={i} className={`chip-mini ${chipClass(v)}`} style={{ width: size, height: size, bottom: i * step, fontSize: size * 0.36 }}>
          {i === chips.length - 1 ? (v >= 1000 ? `${v / 1000}K` : v) : ''}
        </span>
      ))}
      {label && <span className="stack-label">{label}</span>}
    </div>
  );
}
