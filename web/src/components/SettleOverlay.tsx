/**
 * 结算画面：开奖后在牌桌区弹出，放大对比闲/庄的牌面与点数，标出赢方、对子、本人输赢。
 */
import type { Card, HandResult } from '../lib/protocol';
import { CardFace } from './CardFace';

export function SettleOverlay({ result, myNet, onClick }: { result: HandResult; myNet: number | null; onClick?: () => void }) {
  const r = result;
  const label = r.outcome === 'banker' ? '庄 赢' : r.outcome === 'player' ? '闲 赢' : '和 局';
  const tags: string[] = [];
  if (r.playerPair) tags.push('闲对');
  if (r.bankerPair) tags.push('庄对');
  if (r.outcome === 'banker' && r.bankerTotal === 6) tags.push('幸运6');
  if (r.outcome === 'banker' && r.bankerTotal === 7) tags.push('幸运7');
  if (r.playerTotal >= 8 && r.playerCardCount === 2 || r.bankerTotal >= 8 && r.bankerCardCount === 2) tags.push('天牌');
  return (
    <div className="settle-overlay" onClick={onClick}>
      <div className={`settle-title ${r.outcome}`}>{label}</div>
      <div className="settle-hands">
        <BigHand side="player" cards={r.playerCards} total={r.playerTotal} win={r.outcome === 'player'} tie={r.outcome === 'tie'} />
        <div className="settle-vs">VS</div>
        <BigHand side="banker" cards={r.bankerCards} total={r.bankerTotal} win={r.outcome === 'banker'} tie={r.outcome === 'tie'} />
      </div>
      <div className="settle-foot">
        {tags.map((t) => <span key={t} className="settle-tag">{t}</span>)}
        {myNet !== null && myNet !== 0 && <span className={`settle-net ${myNet > 0 ? 'win' : 'lose'}`}>{myNet > 0 ? '+' : ''}{myNet.toLocaleString()}</span>}
        {myNet === 0 && <span className="settle-net muted">本局无输赢</span>}
      </div>
    </div>
  );
}

function BigHand({ side, cards, total, win, tie }: { side: 'player' | 'banker'; cards: Card[]; total: number; win: boolean; tie: boolean }) {
  return (
    <div className={`settle-hand ${side} ${win ? 'win' : ''} ${tie ? 'tie' : ''}`}>
      <div className="settle-hand-title">{side === 'player' ? '闲 PLAYER' : '庄 BANKER'}</div>
      <div className="settle-cards">
        {cards.map((c, i) => <div key={i} className="card big"><CardFace card={c} /></div>)}
      </div>
      <div className="settle-total">{total}<small>点</small></div>
    </div>
  );
}
