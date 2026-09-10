/**
 * 阶段提示动画：
 *  - 派彩结束前 3 秒：绿色倒计时圆环 3-2-1（下一局即将开始）
 *  - 进入投注阶段：绿色横幅"开始投注 PLACE YOUR BETS"滑入并淡出
 *  - 投注最后 5 秒：金色倒计时圆环 + 大号数字，每秒脉冲
 *  - 封盘：红色横幅"停止下注 NO MORE BETS"（与开始横幅同款，只换颜色）
 */
import { useEffect, useRef, useState } from 'react';
import type { TablePhase } from '../lib/protocol';
import { useCountdown } from '../lib/useCountdown';

export function PhaseBanner({ phase, secs, roundId, nextRoundAt }: { phase: TablePhase; secs: number; roundId: string | null; nextRoundAt: number | null }) {
  const [banner, setBanner] = useState<'open' | 'close' | null>(null);
  const lastRound = useRef<string | null>(null);
  const lastPhase = useRef<TablePhase | null>(null);
  const nextSecs = useCountdown(nextRoundAt);

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
      const t = setTimeout(() => setBanner(null), 1400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundId]);
  useEffect(() => { lastPhase.current = phase; }, [phase]);

  const closing = phase === 'betting' && secs > 0 && secs <= 5;                 // 封盘倒计时（金色）
  const opening = phase === 'settling' && nextSecs > 0 && nextSecs <= 3;        // 开局倒计时（绿色）
  const n = closing ? secs : nextSecs;
  const max = closing ? 5 : 3;

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
      {(closing || opening) && (
        <div className={`countdown ${opening ? 'pre' : ''}`} key={`${opening ? 'o' : 'c'}${n}`}>
          <svg viewBox="0 0 100 100" className="cd-ring">
            <circle cx="50" cy="50" r="44" className="cd-track" />
            <circle cx="50" cy="50" r="44" className="cd-arc" style={{ strokeDashoffset: 276 * (1 - n / max) }} />
          </svg>
          <div className="cd-num">{n}</div>
          {opening && <div className="cd-label">即将开局</div>}
        </div>
      )}
    </>
  );
}
