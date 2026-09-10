import { useEffect, useState } from 'react';
import type { TablePhase } from './protocol';

export const PHASE_LABEL: Record<TablePhase, string> = {
  idle: '等待开局', betting: '投注中', dealing: '发牌中', settling: '派彩', shuffling: '洗牌中', maintenance: '维护中',
};

/** 基于服务端给的截止时间戳倒计时（秒） */
export function useCountdown(endsAt: number | null | undefined): number {
  const calc = () => (endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0);
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
