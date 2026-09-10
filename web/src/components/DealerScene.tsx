/**
 * RNG 桌的牌盒 + 飞牌动画
 *
 *  - 牌盒（shoe）：桌面上方的牌靴，露出牌边；出牌时牌靴轻微一顿
 *  - 飞牌：收到 table:card 时，一张牌从牌靴出口翻转着飞到对应手牌的空位上
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '../lib/protocol';
import { CardFace } from './CardFace';

export interface Flight { id: number; side: 'player' | 'banker'; card: Card }


export function DealerScene({ flights, onLanded, shoeId, remaining }: {
  flights: Flight[]; onLanded: (id: number) => void; shoeId?: string | null; remaining?: number;
}) {
  const shoeRef = useRef<HTMLDivElement>(null);
  const [dealing, setDealing] = useState(false);

  useEffect(() => {
    if (!flights.length) return;
    setDealing(true);
    const t = setTimeout(() => setDealing(false), 650);
    return () => clearTimeout(t);
  }, [flights.length]);

  return (
    <div className={`dealer-scene ${dealing ? 'dealing' : ''}`}>

      <div className="shoe" ref={shoeRef} title={`牌靴 ${shoeId ?? ''}`}>
        <div className="shoe-body">
          <div className="shoe-cards"><i /><i /><i /><i /></div>
          <div className="shoe-lip" />
        </div>
        <div className="shoe-label">SHOE{shoeId ? ` · ${shoeId.slice(0, 6)}` : ''}{remaining != null ? ` · 余 ${remaining}` : ''}</div>
      </div>

      {flights.map((f) => <Flyer key={f.id} flight={f} shoeRef={shoeRef} onLanded={onLanded} />)}
    </div>
  );
}

function Flyer({ flight, shoeRef, onLanded }: { flight: Flight; shoeRef: React.RefObject<HTMLDivElement>; onLanded: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current, shoe = shoeRef.current;
    if (!el || !shoe) return;
    const scene = el.closest('.scene') as HTMLElement | null;
    const target = scene?.querySelector(`.hand.${flight.side} .cards`) as HTMLElement | null;
    const base = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const s = shoe.getBoundingClientRect();
    const from = { x: s.left + s.width * 0.15 - base.left, y: s.top + s.height * 0.5 - base.top };
    let to = { x: from.x - 200, y: from.y + 160 };
    if (target) {
      // 落点：第一张尚未落桌的占位格；没有则落在牌区中央
      const slot = target.querySelector('.card-slot.arriving, .card-slot') as HTMLElement | null;
      const t = (slot ?? target).getBoundingClientRect();
      to = { x: t.left + (slot ? 0 : t.width / 2 - 27) - base.left, y: t.top + (slot ? 0 : t.height / 2 - 38) - base.top };
    }
    el.style.left = `${from.x}px`; el.style.top = `${from.y}px`;
    const anim = el.animate(
      [
        { transform: 'translate(0,0) rotate(-8deg) scale(.7)', opacity: 0.9 },
        { transform: `translate(${(to.x - from.x) * 0.5}px, ${(to.y - from.y) * 0.35}px) rotate(180deg) scale(1)`, offset: 0.5 },
        { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) rotate(360deg) scale(1)`, opacity: 1 },
      ],
      { duration: 620, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' },
    );
    anim.onfinish = () => onLanded(flight.id);
    return () => anim.cancel();
  }, [flight.id]); // eslint-disable-line
  return (
    <div ref={ref} className="flyer">
      <div className="flyer-inner">
        <div className="flyer-back" />
        <div className="flyer-face"><CardFace card={flight.card} /></div>
      </div>
    </div>
  );
}
