/**
 * 真实扑克牌面：角标（点数 + 花色，右下角倒置）+ 标准点数排列（pip）
 *  2–10：按实体扑克的排列；A：中央大花色；J/Q/K：花牌框 + 字母 + 花色
 * 尺寸自适应：所有坐标按百分比，容器决定大小。
 */
import type { Card } from '../lib/protocol';

const SUIT: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** 每个点数的 pip 坐标（x% , y%）；y > 50 的 pip 倒置（与实体牌一致） */
const PIPS: Record<string, [number, number][]> = {
  '2': [[50, 24], [50, 76]],
  '3': [[50, 22], [50, 50], [50, 78]],
  '4': [[30, 22], [70, 22], [30, 78], [70, 78]],
  '5': [[30, 22], [70, 22], [50, 50], [30, 78], [70, 78]],
  '6': [[30, 20], [70, 20], [30, 50], [70, 50], [30, 80], [70, 80]],
  '7': [[30, 20], [70, 20], [50, 35], [30, 50], [70, 50], [30, 80], [70, 80]],
  '8': [[30, 20], [70, 20], [50, 35], [30, 50], [70, 50], [50, 65], [30, 80], [70, 80]],
  '9': [[32, 18], [68, 18], [32, 39.5], [68, 39.5], [50, 50], [32, 60.5], [68, 60.5], [32, 82], [68, 82]],
  'T': [[32, 18], [68, 18], [50, 29], [32, 39.5], [68, 39.5], [32, 60.5], [68, 60.5], [50, 71], [32, 82], [68, 82]],
};

/** pip 字号（相对牌高）：点越多越小，避免重叠；与实体扑克比例接近 */
const PIP_SIZE: Record<string, number> = { '2': 23, '3': 21, '4': 21, '5': 20, '6': 18, '7': 17, '8': 17, '9': 15, 'T': 15 };

/**
 * 牌面风格：
 *  'wpk'  — 扑克 App（WePoker 一类）的清晰大字风格：左上大点数 + 花色，右下大花色。小尺寸/手机上最易读（默认）
 *  'pips' — 实体扑克的点数排列
 */
export type CardStyle = 'wpk' | 'pips';
export const CARD_STYLE: CardStyle = 'pips';

export function CardFace({ card, className = '', style = CARD_STYLE }: { card: Card; className?: string; style?: CardStyle }) {
  const red = card.suit === 'H' || card.suit === 'D';
  const suit = SUIT[card.suit];
  const rank = card.rank === 'T' ? '10' : card.rank;
  if (style === 'wpk') {
    return (
      <div className={`cf wpk ${red ? 'red' : 'black'} ${className}`}>
        <div className="wpk-rank">{rank}</div>
        <div className="wpk-suit-sm">{suit}</div>
        <div className="wpk-suit-lg">{suit}</div>
      </div>
    );
  }
  const pips = PIPS[card.rank];
  const court = 'JQK'.includes(card.rank);
  return (
    <div className={`cf ${red ? 'red' : 'black'} ${className}`}>
      <div className="cf-idx tl"><span>{rank}</span><span>{suit}</span></div>
      <div className="cf-idx br"><span>{rank}</span><span>{suit}</span></div>
      {pips && (
        <div className="cf-pips" style={{ fontSize: `${PIP_SIZE[card.rank]}cqh` }}>
          {pips.map(([x, y], i) => (
            <span key={i} className={`cf-pip ${y > 50 ? 'flip' : ''}`} style={{ left: `${x}%`, top: `${y}%` }}>{suit}</span>
          ))}
        </div>
      )}
      {card.rank === 'A' && <div className="cf-ace">{suit}</div>}
      {court && (
        <div className="cf-court">
          <div className="cf-court-inner">
            <span className="cf-court-suit tl">{suit}</span>
            <span className="cf-court-letter">{card.rank}</span>
            <span className="cf-court-suit br">{suit}</span>
          </div>
        </div>
      )}
    </div>
  );
}
