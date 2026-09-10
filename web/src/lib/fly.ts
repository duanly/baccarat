/**
 * 通用飞行动画：把一个临时元素从 A 点飞到 B 点（筹码 / 牌 都用它）。
 * 元素挂在 body 上、fixed 定位，用 Web Animations API 做位移 + 缩放 + 旋转，结束后自动移除。
 */
export interface FlyOptions {
  duration?: number;
  arc?: number;        // 抛物线高度（px），0 = 直线
  spin?: number;       // 旋转角度
  scaleFrom?: number;
  scaleTo?: number;
  delay?: number;
}

type Point = { x: number; y: number };

export function centerOf(el: Element | null | undefined): Point | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function fly(node: HTMLElement, from: Point, to: Point, opts: FlyOptions = {}): Promise<void> {
  const { duration = 450, arc = 40, spin = 0, scaleFrom = 1, scaleTo = 1, delay = 0 } = opts;
  Object.assign(node.style, { position: 'fixed', left: '0px', top: '0px', pointerEvents: 'none', zIndex: '1000', willChange: 'transform' } as CSSStyleDeclaration);
  document.body.appendChild(node);
  const w = node.offsetWidth, h = node.offsetHeight;
  const p = (pt: Point) => `translate(${pt.x - w / 2}px, ${pt.y - h / 2}px)`;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - arc };
  const anim = node.animate(
    [
      { transform: `${p(from)} rotate(0deg) scale(${scaleFrom})`, opacity: 1 },
      { transform: `${p(mid)} rotate(${spin / 2}deg) scale(${(scaleFrom + scaleTo) / 2 * 1.15})`, offset: 0.5 },
      { transform: `${p(to)} rotate(${spin}deg) scale(${scaleTo})`, opacity: 1 },
    ],
    { duration, delay, easing: 'cubic-bezier(.25,.8,.35,1)', fill: 'both' },
  );
  return new Promise((resolve) => {
    anim.onfinish = () => { node.remove(); resolve(); };
    anim.oncancel = () => { node.remove(); resolve(); };
  });
}

/** 造一枚筹码 DOM（与投注面板上的筹码同款式） */
export function makeChipNode(value: number, size = 34): HTMLElement {
  const el = document.createElement('div');
  el.className = `chip-mini fly-chip c${value}`;
  el.style.width = `${size}px`; el.style.height = `${size}px`; el.style.fontSize = `${size * 0.36}px`;
  el.textContent = value >= 1000 ? `${value / 1000}K` : String(value);
  return el;
}

/** 金额拆成几枚代表性筹码（最多 n 枚），用于"别人下注"飞入 */
export function representativeChips(amount: number, n = 3): number[] {
  const out: number[] = [];
  let rest = amount;
  for (const v of [5000, 1000, 500, 100, 50, 10]) {
    while (rest >= v && out.length < n) { out.push(v); rest -= v; }
  }
  return out.length ? out : [10];
}
