import { useEffect, useState } from 'react';
import type { TablePhase } from './protocol';

export const PHASE_LABEL: Record<TablePhase, string> = {
  idle: '等待开局', betting: '投注中', dealing: '发牌中', settling: '派彩', shuffling: '洗牌中', maintenance: '维护中',
};

/**
 * 服务端与本机的时钟偏差（服务端时间 − 本机时间）。手机时钟快几秒的话，倒计时会提前归零然后干等服务端封盘；
 * 每次收到牌桌快照都用其中的 serverTime 校准一次。
 */
let clockOffset = 0;
export const syncClock = (serverTime: number) => { if (typeof serverTime === 'number') clockOffset = serverTime - Date.now(); };
export const serverNow = () => Date.now() + clockOffset;

/** 基于服务端给的截止时间戳倒计时（秒），已按时钟偏差校正 */
export function useCountdown(endsAt: number | null | undefined): number {
  const calc = () => (endsAt ? Math.max(0, Math.ceil((endsAt - serverNow()) / 1000)) : 0);
  const [s, setS] = useState(calc);
  useEffect(() => {
    setS(calc());
    if (!endsAt) return;
    const t = setInterval(() => setS(calc()), 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);
  return s;
}
