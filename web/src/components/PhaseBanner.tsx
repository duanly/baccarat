/**
 * 阶段提示动画：
 *  - 进入投注阶段：横幅"开始投注 PLACE YOUR BETS"滑入并淡出（约 1.4s）
 *  - 投注最后 5 秒：中央大号倒计时数字 + 收缩圆环，每秒脉冲
 *  - 封盘：横幅"停止下注 NO MORE BETS"
 */
import { useEffect, useRef, useState } from 'react';
import type { TablePhase } from '../lib/protocol';

export function PhaseBanner({ phase, secs, roundId }: { phase: TablePhase; secs: number; roundId: string | null }) {
  const [banner, setBanner] = useState<'open' | 'close' | null>(null);
  const lastRound = useRef<string | null>(null);
  const lastPhase = useRef<TablePhase | null>(null);

  useEffect(() => {
    // 新一局进入投注：开始投注横幅
    if (phase === 'betting' && lastRound.current !== roundId) {
      lastRound.current = roundId;
      if (secs <= 5) return;            // 中途进桌且已到最后 5 秒：直接走倒计时，不再弹开始横幅
      setBanner('open');
      const t = setTimeout(() => setBanner(null), 1400);
      return () => clearTimeout(t);
    }
    // 从投注切到发牌：停止下注横幅
    if (lastPhase.current === 'betting' && phase === 'dealing') {
      setBanner('close');
      const t = setTimeout(() => setBanner(null), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundId]);
  useEffect(() => { lastPhase.current = phase; }, [phase]);

  const countdown = phase === 'betting' && secs > 0 && secs <= 5;

  return (
    <>
      {banner === 'open' && (
        <div className="phase-banner open" key="open">
          <div className="pb-main">开始投注</div>
          <div className="pb-sub">PLACE YOUR BETS</div>
        </div>
      )}
      {banner === 'close' && (
        <div className="phase-banner close" key="close">
          <div className="pb-main">停止下注</div>
          <div className="pb-sub">NO MORE BETS</div>
        </div>
      )}
      {countdown && (
        <div className="countdown" key={secs}>
          <svg viewBox="0 0 100 100" className="cd-ring">
            <circle cx="50" cy="50" r="44" className="cd-track" />
            <circle cx="50" cy="50" r="44" className="cd-arc" style={{ strokeDashoffset: 276 * (1 - secs / 5) }} />
          </svg>
          <div className="cd-num">{secs}</div>
        </div>
      )}
    </>
  );
}
