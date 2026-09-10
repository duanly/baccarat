/**
 * 玩法说明浮窗：投注区右上角 "?" 按钮打开，逐项解释每种押注与本桌赔率。
 */
import { useEffect } from 'react';
import { BET_LABELS, payoutLabel, type BetType, type PayoutTable } from '../lib/protocol';

const desc = (p: PayoutTable): Record<BetType, string> => ({
  player: '押闲家点数大于庄家。闲家赢即中，和局退回本金。',
  banker: '押庄家点数大于闲家。庄家赢即中，和局退回本金；传统桌抽 5% 佣金，免佣桌庄家以 6 点赢只赔一半。',
  tie: '押庄闲最终点数相同。开出和局即中，赔率高但出现概率低。',
  playerPair: '押闲家头两张牌点数相同（花色不限），如 7♠ 7♥。第三张牌不算。',
  bankerPair: '押庄家头两张牌点数相同（花色不限）。第三张牌不算。',
  anyPair: '押庄或闲任意一方头两张牌成对，两方都成对也只按一注赔。',
  perfectPair: '押庄或闲头两张牌点数与花色完全相同，如 K♦ K♦。',
  lucky6: `押庄家以 6 点获胜：庄家两张牌合 6 点赢赔 ${p.lucky6TwoCards} 倍，三张牌合 6 点赢赔 ${p.lucky6ThreeCards} 倍。`,
  lucky7: `押庄家以 7 点获胜：庄家两张牌合 7 点赢赔 ${p.lucky7TwoCards} 倍，三张牌合 7 点赢赔 ${p.lucky7ThreeCards} 倍。`,
  big: '押本局总发牌张数为 5 或 6 张（即任一方补了第三张牌）。',
  small: '押本局总发牌张数只有 4 张（双方都不补牌）。',
});

const ORDER: BetType[] = ['player', 'banker', 'tie', 'playerPair', 'bankerPair', 'anyPair', 'perfectPair', 'lucky6', 'lucky7', 'big', 'small'];

export function BetHelp({ payouts, onClose }: { payouts: PayoutTable; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const DESC = desc(payouts);
  return (
    <div className="help-mask" onClick={onClose}>
      <div className="help-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <b>玩法说明</b>
          <span className="muted small">赔率为净赔付：押 100 中「1:8」得 800 + 本金</span>
          <button className="help-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="help-list">
          {ORDER.map((t) => (
            <div className={`help-row ${t}`} key={t}>
              <div className="help-name"><span className={`help-tag ${t}`}>{BET_LABELS[t]}</span><span className="help-odds">{payoutLabel(t, payouts)}</span></div>
              <div className="help-desc">{DESC[t]}</div>
            </div>
          ))}
          <div className="help-note muted small">
            点数规则：A=1，2–9 按面值，10/J/Q/K=0，合计取个位数。任一方头两张 8 或 9 点为「天牌」，双方都不再补牌。
            闲家 0–5 点补牌；庄家是否补牌取决于自身点数与闲家第三张牌（标准 Punto Banco 规则，由系统自动执行）。
          </div>
        </div>
      </div>
    </div>
  );
}
