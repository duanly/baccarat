/**
 * 咪牌（Squeeze）：牌面朝下，玩家从牌角 / 牌边按住拖动，牌背像被掀起一样逐渐露出牌面。
 *
 *  - 按下位置决定掀牌方式：靠近角落 → 掀角（斜切）；靠近某条边 → 从该边整体掀起
 *  - 拖动力度决定档位：1/5 → 1/3 → 1/2 → 全开；松手时到 1/2 及以上则完全翻开，否则弹回盖住
 *  - 双击 / 长按空白处（或点"翻开"）直接翻牌
 *  - 牌背用 clip-path 裁剪，卷边用渐变条模拟
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../lib/protocol';
import { CardFace } from './CardFace';

/**
 * 分档掀牌：按拖动力度（距离占牌尺寸的比例）落到固定档位，模拟线下"先露一点点、再多一点"的手感
 *   轻拉 → 1/5，再拉 → 1/3，再拉 → 1/2，拉到底 → 全开
 */
const STAGES: [number, number][] = [[0.08, 0.2], [0.24, 0.34], [0.42, 0.5], [0.66, 1]];
function stageOf(dist: number): number {
  let p = 0;
  for (const [th, v] of STAGES) if (dist >= th) p = v;
  return p;
}
type Mode = 'corner-br' | 'corner-bl' | 'corner-tr' | 'corner-tl' | 'edge-b' | 'edge-t' | 'edge-l' | 'edge-r';

export function SqueezeCard({ card, revealed, onReveal, rotated }: { card: Card; revealed: boolean; onReveal: () => void; rotated?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);             // 掀开比例 0..1
  const [mode, setMode] = useState<Mode>('corner-br');
  const drag = useRef<{ x: number; y: number; mode: Mode; w: number; h: number } | null>(null);
  const [flipping, setFlipping] = useState(false);

  const finish = useCallback(() => {
    setFlipping(true);
    setTimeout(() => { onReveal(); setFlipping(false); setP(0); }, 260);
  }, [onReveal]);

  const onDown = (e: React.PointerEvent) => {
    if (revealed) return;
    const r = ref.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const nearL = x < 0.35, nearR = x > 0.65, nearT = y < 0.35, nearB = y > 0.65;
    let m: Mode = 'corner-br';
    if (nearB && nearR) m = 'corner-br'; else if (nearB && nearL) m = 'corner-bl';
    else if (nearT && nearR) m = 'corner-tr'; else if (nearT && nearL) m = 'corner-tl';
    else if (nearB) m = 'edge-b'; else if (nearT) m = 'edge-t'; else if (nearL) m = 'edge-l'; else if (nearR) m = 'edge-r';
    else m = y > 0.5 ? 'edge-b' : 'edge-t';
    drag.current = { x: e.clientX, y: e.clientY, mode: m, w: r.width, h: r.height };
    setMode(m);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    let dist = 0;
    switch (d.mode) {
      case 'corner-br': dist = (-dx - dy) / ((d.w + d.h) / 2); break;
      case 'corner-bl': dist = (dx - dy) / ((d.w + d.h) / 2); break;
      case 'corner-tr': dist = (-dx + dy) / ((d.w + d.h) / 2); break;
      case 'corner-tl': dist = (dx + dy) / ((d.w + d.h) / 2); break;
      case 'edge-b': dist = -dy / d.h; break;
      case 'edge-t': dist = dy / d.h; break;
      case 'edge-l': dist = dx / d.w; break;
      case 'edge-r': dist = -dx / d.w; break;
    }
    setP(stageOf(Math.max(0, dist)));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (p >= 0.5) finish(); else setP(0);
  };

  useEffect(() => { if (revealed) setP(0); }, [revealed]);

  const clip = coverClip(mode, p);
  const fold = foldStyle(mode, p);

  return (
    <div
      ref={ref}
      className={`card squeeze ${revealed ? 'revealed' : ''} ${flipping ? 'flipping' : ''} ${rotated ? 'rot' : ''} ${p > 0 ? 'active' : ''}`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onDoubleClick={() => !revealed && finish()}
    >
      <div className="face"><CardFace card={card} /></div>
      {!revealed && (
        <>
          <div className="back" style={{ clipPath: clip }} />
          {p > 0.02 && <div className="fold" style={fold} />}
        </>
      )}
    </div>
  );
}

/** 牌背可见区域（掀开的部分被裁掉） */
function coverClip(mode: Mode, p: number): string {
  const q = Math.round(p * 1000) / 10; // 百分比
  const c = Math.min(100, q * 2);       // 角落斜切用两倍进度
  switch (mode) {
    case 'edge-b': return `inset(0 0 ${q}% 0)`;
    case 'edge-t': return `inset(${q}% 0 0 0)`;
    case 'edge-l': return `inset(0 0 0 ${q}%)`;
    case 'edge-r': return `inset(0 ${q}% 0 0)`;
    case 'corner-br': return `polygon(0 0, 100% 0, 100% ${100 - c}%, ${100 - c}% 100%, 0 100%)`;
    case 'corner-bl': return `polygon(0 0, 100% 0, 100% 100%, ${c}% 100%, 0 ${100 - c}%)`;
    case 'corner-tr': return `polygon(0 0, ${100 - c}% 0, 100% ${c}%, 100% 100%, 0 100%)`;
    case 'corner-tl': return `polygon(${c}% 0, 100% 0, 100% 100%, 0 100%, 0 ${c}%)`;
  }
}

/** 卷边高光：贴在掀开边缘的一条渐变带 */
function foldStyle(mode: Mode, p: number): React.CSSProperties {
  const q = p * 100, c = Math.min(100, q * 2);
  const base: React.CSSProperties = { position: 'absolute', pointerEvents: 'none' };
  switch (mode) {
    case 'edge-b': return { ...base, left: 0, right: 0, bottom: `${q}%`, height: 10, background: 'linear-gradient(to top, rgba(0,0,0,.35), rgba(255,255,255,.7))' };
    case 'edge-t': return { ...base, left: 0, right: 0, top: `${q}%`, height: 10, background: 'linear-gradient(to bottom, rgba(0,0,0,.35), rgba(255,255,255,.7))' };
    case 'edge-l': return { ...base, top: 0, bottom: 0, left: `${q}%`, width: 10, background: 'linear-gradient(to right, rgba(0,0,0,.35), rgba(255,255,255,.7))' };
    case 'edge-r': return { ...base, top: 0, bottom: 0, right: `${q}%`, width: 10, background: 'linear-gradient(to left, rgba(0,0,0,.35), rgba(255,255,255,.7))' };
    case 'corner-br': return { ...base, right: 0, bottom: 0, width: `${c}%`, height: `${c}%`, background: 'linear-gradient(135deg, transparent 45%, rgba(255,255,255,.75) 50%, rgba(0,0,0,.35) 56%, transparent 62%)' };
    case 'corner-bl': return { ...base, left: 0, bottom: 0, width: `${c}%`, height: `${c}%`, background: 'linear-gradient(225deg, transparent 45%, rgba(255,255,255,.75) 50%, rgba(0,0,0,.35) 56%, transparent 62%)' };
    case 'corner-tr': return { ...base, right: 0, top: 0, width: `${c}%`, height: `${c}%`, background: 'linear-gradient(45deg, transparent 45%, rgba(255,255,255,.75) 50%, rgba(0,0,0,.35) 56%, transparent 62%)' };
    case 'corner-tl': return { ...base, left: 0, top: 0, width: `${c}%`, height: `${c}%`, background: 'linear-gradient(315deg, transparent 45%, rgba(255,255,255,.75) 50%, rgba(0,0,0,.35) 56%, transparent 62%)' };
  }
}
