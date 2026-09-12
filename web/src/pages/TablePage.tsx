import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { socket } from '../lib/ws';
import { useSession } from '../App';
import { BET_LABELS, payoutLabel, type BetType, type Bets, type Card, type LeaderboardEntry, type TableSnapshot } from '../lib/protocol';
import { RoadmapPanel } from '../components/Roadmap';
import { LiveVideo } from '../components/LiveVideo';
import { ChipStack } from '../components/ChipStack';
import { DealerScene, type Flight } from '../components/DealerScene';
import { SqueezeCard } from '../components/SqueezeCard';
import { CardFace } from '../components/CardFace';
import { SettleOverlay } from '../components/SettleOverlay';
import { PhaseBanner } from '../components/PhaseBanner';
import { BetHelp } from '../components/BetHelp';
import { RoomPanel } from '../components/RoomPanel';
import { api } from '../lib/api';
import type { RoomInfo } from '../lib/protocol';
import { fly, centerOf, makeChipNode, representativeChips } from '../lib/fly';
import { native } from '../lib/native';
import { useCountdown, PHASE_LABEL } from '../lib/useCountdown';
import { useOrientation, useWide } from '../lib/useOrientation';
import { chipSetFor, setChipSet, chipLabel } from '../lib/chips';
import { sound, unlockOnGesture } from '../lib/sound';

const MAIN: BetType[] = ['player', 'tie', 'banker'];
// 边注：完美对子、幸运 7 已下架（服务端同样拒收）
const SIDE: BetType[] = ['playerPair', 'anyPair', 'bankerPair', 'lucky6', 'big', 'small'];

export function TablePage() {
  const { id = '' } = useParams();
  const { user, setUser } = useSession();
  const [table, setTable] = useState<TableSnapshot | null>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);     // 私人房信息（只有 room-* 桌有）
  const [roomPanel, setRoomPanel] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null); // 满房 / 上锁 / 无权限时的提示
  const [confirmed, setConfirmed] = useState<Bets>({});   // 服务端已接受的本局注码
  const [pending, setPending] = useState<Bets>({});       // 本地待提交
  const history = useRef<BetType[]>([]); // 最近下注过的投注区顺序（撤注用：每按一次撤回一个区的全部注码）
  const touch = (t: BetType) => { history.current = [...history.current.filter((x) => x !== t), t]; };
  const [chip, setChip] = useState(100);
  // 本桌筹码面额：随限红变化；进桌 / 限红改动时默认选中第二小的一枚
  const CHIPS = useMemo(() => chipSetFor(table?.limits.minBet ?? 10, table?.limits.maxBet ?? 5000), [table?.limits.minBet, table?.limits.maxBet]);
  useEffect(() => { setChipSet(CHIPS); if (!CHIPS.includes(chip)) setChip(CHIPS[Math.min(1, CHIPS.length - 1)]); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [CHIPS]);
  const [toast, setToast] = useState<string>('');
  const [lastSettle, setLastSettle] = useState<number | null>(null);
  const [mySettlements, setMySettlements] = useState<any[] | null>(null);
  const [overlay, setOverlay] = useState(false);       // 结算画面
  const [overlayOut, setOverlayOut] = useState(false); // 结算画面淡出中
  const [help, setHelp] = useState(false);             // 玩法说明浮窗
  const [cleared, setCleared] = useState(false);       // 结算画面结束后清空桌面上一局的牌
  const [paidOut, setPaidOut] = useState(false);       // 派彩动画已完成 → 隐藏桌上筹码
  const payoutDone = useRef(false);
  const [myAllIn, setMyAllIn] = useState(false);
  // RNG 桌：飞牌动画；landed = 每边已落桌的张数（未落桌的牌先隐藏）
  const [flights, setFlights] = useState<Flight[]>([]);
  const [landed, setLanded] = useState({ player: 0, banker: 0 });
  const flightSeq = useRef(0);
  // VIP 桌：咪牌，已翻开的牌 key = side+index
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const kindRef = useRef<'rng' | 'live'>('rng');
  const secs = useCountdown(table?.countdownEndsAt);
  const { orientation, set: setOrientation } = useOrientation();
  const landscape = orientation === 'landscape';
  const wide = useWide() || landscape;   // 手机横屏或桌面宽屏：右列放玩家列表 + 牌路

  // 进桌允许自由旋转，离桌回到竖屏
  useEffect(() => { native.setOrientation('auto'); unlockOnGesture(); return () => native.setOrientation('portrait'); }, []);
  const [soundOn, setSoundOn] = useState(sound.enabled);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); }, []);

  useEffect(() => {
    if (id.startsWith('room-')) api.table(id).then((r) => setRoom(r.room ?? null)).catch((e) => setBlocked(e.message));
  }, [id]);

  useEffect(() => {
    socket.subscribe(id);
    const off = socket.on((m) => {
      if (m.tableId && m.tableId !== id && m.table?.id !== id) return;
      switch (m.type) {
        case 'table:state':
          setTable((prev) => {
            kindRef.current = m.table.kind;
            if (m.myBets) setConfirmed(m.myBets);
            else if (prev && prev.roundId !== m.table.roundId) { setConfirmed({}); setPending({}); setMyAllIn(false); history.current = []; } // 新一局：清空注码
            if (!prev || prev.roundId !== m.table.roundId) {
              setOverlay(false); setPaidOut(false); setMySettlements(null); setCleared(false); payoutDone.current = false;
              // 新一局 / 首次进桌：已有的牌视为已落桌；咪牌记录清空
              setLanded({ player: m.table.playerCards.length, banker: m.table.bankerCards.length });
              setFlights([]);
              setRevealed(new Set());
            }
            return m.table;
          });
          break;
        case 'table:card':
          sound.card();
          if (kindRef.current === 'rng') setFlights((f) => [...f, { id: ++flightSeq.current, side: m.side, card: m.card }]);
          setTable((t) => t && ({
            ...t,
            playerCards: m.side === 'player' ? [...t.playerCards, m.card] : t.playerCards,
            bankerCards: m.side === 'banker' ? [...t.bankerCards, m.card] : t.bankerCards,
            playerTotal: m.playerTotal, bankerTotal: m.bankerTotal, phase: 'dealing',
          }));
          break;
        case 'table:result':
          setTable((t) => t && ({ ...t, lastResult: m.result, roadmap: m.roadmap, phase: 'settling', nextRoundAt: m.nextRoundAt ?? null }));
          // 咪牌：开奖后 3 秒未翻开的牌自动翻开
          setTimeout(() => setRevealed(new Set(['player0', 'player1', 'player2', 'banker0', 'banker1', 'banker2'])), 3000);
          break;
        case 'table:bets':
          setTable((t) => t && ({ ...t, leaderboard: m.leaderboard }));
          break;
        case 'bet:ok':
          if (ackTimer.current) { clearTimeout(ackTimer.current); ackTimer.current = null; }
          setConfirmed(m.bets); setPending({});
          if (m.allIn) { setMyAllIn(true); flash('梭哈 ALL IN！'); native.vibrate(); }
          break;
        case 'settled': {
          const net = (m.settlements as any[]).reduce((s, x) => s + x.net, 0);
          setLastSettle(net);
          setMySettlements(m.settlements);
          if (net > 0) setTimeout(() => sound.cheer(), 300);   // 结算画面弹出时欢呼
          setTimeout(() => setLastSettle(null), 6000);
          break;
        }
        case 'table:closed':
          setBlocked(m.message ?? '房间已关闭');
          break;
        case 'error':
          if (ackTimer.current) { clearTimeout(ackTimer.current); ackTimer.current = null; }
          if (/满房|上锁|密码|已关闭|正在关闭|VIP/.test(m.message) && !table) { setBlocked(m.message); break; }
          flash(m.message);
          setPending({}); history.current = [];
          break;
      }
    });
    return () => { off(); socket.unsubscribe(id); };
  }, [id, flash]);

  // 连接状态提示：断线时显示"重连中"，重连成功后服务端会重推 table:state（含本人注码）
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    socket.onStatus = (st) => setOffline(st === 'closed');
    setOffline(!socket.connected);
    return () => { socket.onStatus = null; };
  }, []);
  // 下注后 4 秒没收到回执：多半是半开连接（手机静置后常见），强制重连，重连后会拿到服务端的真实注码
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expectAck = useCallback(() => {
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => { ackTimer.current = null; flash('网络不稳定，正在重连…'); socket.reconnect(); }, 4000);
  }, [flash]);

  const onLanded = useCallback((id: number) => {
    setFlights((f) => {
      const fl = f.find((x) => x.id === id);
      if (fl) setLanded((l) => ({ ...l, [fl.side]: l[fl.side] + 1 }));
      return f.filter((x) => x.id !== id);
    });
  }, []);
  const reveal = useCallback((key: string) => setRevealed((r) => new Set(r).add(key)), []);

  const betting = table?.phase === 'betting' && secs > 0;
  const total = (b: Bets) => Object.values(b).reduce((s, v) => s + (v ?? 0), 0);

  // 可用余额 = 账户余额（已确认注码已扣） - 待确认注码；向下取整，梭哈时不把余额里的小数压进去
  const available = Math.max(0, Math.floor((user?.balance ?? 0) - total(pending)));
  const pendingAllIn = total(pending) > 0 && available <= 0;

  const addChip = (t: BetType) => {
    if (!betting) return;
    if (available <= 0) { flash(total(pending) > 0 ? '已梭哈：筹码全部压上' : '余额不足'); native.vibrate(); return; }
    const add = Math.min(chip, available);   // 不够一枚筹码 → 剩多少压多少（梭哈）
    if (add < chip) flash(`余额不足一枚筹码，已压上剩余 $${add.toLocaleString()}（梭哈）`);
    // 筹码从筹码栏飞到投注区，落地后再计入待确认注码
    sound.chipPlace();
    const from = centerOf(document.querySelector('.chips .chip.sel'));
    const spot = document.querySelector(`.spot.${t}`);
    const to = centerOf(spot?.querySelector('.mine-wrap')) ?? centerOf(spot);
    if (from && to) {
      fly(makeChipNode(chip), from, to, { duration: 380, arc: 60, spin: 360, scaleFrom: 1.1, scaleTo: 0.75 })
        .then(() => { touch(t); setPending((p) => ({ ...p, [t]: (p[t] ?? 0) + add })); });
    } else {
      touch(t);
      setPending((p) => ({ ...p, [t]: (p[t] ?? 0) + add }));
    }
    native.vibrate();
  };
  const allInNow = () => {
    if (!betting || available <= 0) return;
    // 一键梭哈：把剩余全部压到当前选中的第一个区域（默认庄）
    const target = (Object.keys(pending)[0] ?? Object.keys(confirmed)[0] ?? 'banker') as BetType;
    touch(target);
    setPending((p) => ({ ...p, [target]: (p[target] ?? 0) + available }));
  };
  const submit = () => { if (total(pending) > 0) { sound.confirm(); socket.send({ type: 'bet', tableId: id, bets: pending }); expectAck(); } };
  /** 撤注：撤回最近下注的那个投注区的全部注码（待确认的直接清掉；已确认的请求服务端退款），筹码飞回筹码栏 */
  const undoLast = () => {
    let t = history.current.pop();
    if (!t) t = (Object.keys(shown) as BetType[]).find((k) => (shown[k] ?? 0) > 0);   // 没有记录（如刷新后）就撤回第一个有注码的区
    if (!t) return;
    const amt = shown[t] ?? 0;
    const tray = centerOf(document.querySelector('.chips .chip.sel'));
    const from = centerOf(document.querySelector(`.spot.${t} .mine-wrap`));
    if (from && tray && amt) representativeChips(amt, 3).forEach((c, i) => fly(makeChipNode(c, 28), from, tray, { duration: 320, arc: 30, delay: i * 40, scaleTo: 0.6 }));
    setPending((p) => { const n = { ...p }; delete n[t!]; return n; });
    if (confirmed[t]) { socket.send({ type: 'clearBet', tableId: id, betType: t }); expectAck(); }
    sound.chipBack();
    native.vibrate();
  };
  // 重复：把上一局的注码直接提交（不用再按确认）
  const rebet = () => { if (betting && lastBets && total(lastBets) > 0) { sound.chipPlace(); socket.send({ type: 'bet', tableId: id, bets: lastBets }); expectAck(); history.current = Object.keys(lastBets) as BetType[]; } };
  const [lastBets, setLastBets] = useState<Bets | null>(null);
  useEffect(() => { if (table?.phase === 'dealing' && total(confirmed) > 0) setLastBets(confirmed); }, [table?.phase]); // eslint-disable-line

  const shown = useMemo(() => {
    const out: Bets = { ...confirmed };
    for (const [k, v] of Object.entries(pending)) out[k as BetType] = (out[k as BetType] ?? 0) + (v ?? 0);
    return out;
  }, [confirmed, pending]);

  // 其他玩家在各区域的注码（本局），用于在桌面上显示别人的筹码
  const others = useMemo(() => {
    const out: Record<string, { amount: number; players: number }> = {};
    for (const e of table?.leaderboard ?? []) {
      if (e.userId === user?.id) continue;
      for (const [k, v] of Object.entries(e.currentBets)) {
        if (!v) continue;
        const o = (out[k] ??= { amount: 0, players: 0 });
        o.amount += v; o.players += 1;
      }
    }
    return out;
  }, [table?.leaderboard, user?.id]);

  // 其他玩家新增注码 → 从玩家面板飞一枚筹码到对应区域
  const prevOthers = useRef<Record<string, number>>({});
  useEffect(() => {
    const prev = prevOthers.current;
    const from = centerOf(document.querySelector('.players .panel-title')) ?? { x: window.innerWidth - 40, y: 80 };
    let played = false;
    for (const [t, o] of Object.entries(others)) {
      const delta = o.amount - (prev[t] ?? 0);
      if (delta > 0 && Object.keys(prev).length) {
        const to = centerOf(document.querySelector(`.spot.${t} .others-wrap`)) ?? centerOf(document.querySelector(`.spot.${t}`));
        if (to) representativeChips(delta, 2).forEach((c, i) => fly(makeChipNode(c, 22), from, to, { duration: 500, arc: 80, delay: i * 60, scaleFrom: 0.8, scaleTo: 0.6 }));
        // 别人下注也有筹码声（稍轻、延迟到筹码落桌时；同一次更新多个区域只响一声）
        if (!played) { played = true; setTimeout(() => sound.chipPlace(0.55), 420); }
      }
    }
    const next: Record<string, number> = {};
    for (const [t, o] of Object.entries(others)) next[t] = o.amount;
    if (!Object.keys(prev).length && !Object.keys(next).length) next.__init = 1; // 首次快照不飞
    prevOthers.current = next;
  }, [others]);

  const r = table?.lastResult ?? null;
  // 咪牌桌：所有牌翻开之前不公布结果（避免剧透）
  const allRevealed = !table || table.kind !== 'live' || [...table.playerCards.keys()].every((i) => revealed.has('player' + i)) && [...table.bankerCards.keys()].every((i) => revealed.has('banker' + i));
  const showResult = !!table && table.phase === 'settling' && !!r && allRevealed;

  // 开奖（且咪牌桌全部翻开）→ 结算画面 1.5s → 渐隐 3s + 开局倒计时 3s（同步）→ 开始下注 + 派彩动画 + 开局 3 秒倒计时（服务端派彩停顿 6s）
  useEffect(() => {
    if (!showResult || payoutDone.current) return;
    payoutDone.current = true;
    setOverlay(true); setOverlayOut(false);
    // 1.5s 后：开局 3 秒倒计时开始，结算画面同步用 3s 渐隐，桌面清空 + 派彩动画；倒计时归零时画面刚好消失，服务端开下一局
    const t0 = setTimeout(() => { setOverlayOut(true); setCleared(true); runPayout(); }, 1500);
    const t1 = setTimeout(() => { setOverlay(false); setOverlayOut(false); }, 4500);
    return () => { clearTimeout(t0); clearTimeout(t1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResult]);

  if (blocked) return (
    <div className="center blocked">
      <div className="blocked-box">
        <b>{blocked}</b>
        <Link to="/" className="primary link-btn">返回大厅</Link>
      </div>
    </div>
  );
  if (!table) return <div className="center muted">连接牌桌…</div>;

  /**
   * 派彩动画：
   *  - 输的区域：桌上筹码飞向牌盒（被收走）
   *  - 赢的区域：牌盒飞出赔付筹码落到该区域，随后本金 + 赔付一起飞向余额
   *  - 和局退回（push）：筹码直接飞回余额
   *  其他玩家的筹码同样按输赢收走 / 派出，但派出后淡出（不飞向自己的余额）
   */
  const runPayout = () => {
    const res = table?.lastResult; if (!res) return;
    const house = centerOf(document.querySelector('.shoe')) ?? centerOf(document.querySelector('.scene')) ?? { x: window.innerWidth / 2, y: 60 };
    const wallet = centerOf(document.querySelector('.userbar .balance')) ?? { x: window.innerWidth - 60, y: 20 };
    const winners = new Set<BetType>(); const pushes = new Set<BetType>();
    for (const t of Object.keys(BET_LABELS) as BetType[]) {
      const m = isWinning(t, res);
      if (m) winners.add(t);
      else if ((t === 'player' || t === 'banker') && res.outcome === 'tie') pushes.add(t);
    }
    let delay = 0;
    // 1. 收走输的筹码（自己 + 他人）
    for (const t of Object.keys(BET_LABELS) as BetType[]) {
      if (winners.has(t) || pushes.has(t)) continue;
      for (const sel of [`.spot.${t} .mine-wrap`, `.spot.${t} .others-wrap`]) {
        const from = centerOf(document.querySelector(sel));
        const amt = sel.includes('mine') ? (confirmed[t] ?? 0) : (others[t]?.amount ?? 0);
        if (!from || !amt) continue;
        representativeChips(amt, 3).forEach((c, i) => fly(makeChipNode(c, sel.includes('mine') ? 26 : 20), from, house, { duration: 520, arc: 60, delay: delay + i * 50, scaleTo: 0.4 }));
      }
    }
    delay += 500;
    // 2. 派出赢的筹码：牌盒 → 区域（伴随筹码碰撞声）
    if (winners.size) setTimeout(() => sound.chipPay(6 + winners.size * 2), delay);
    for (const t of winners) {
      const spot = document.querySelector(`.spot.${t}`);
      const mineAmt = confirmed[t] ?? 0, othersAmt = others[t]?.amount ?? 0;
      if (mineAmt) {
        const to = centerOf(spot?.querySelector('.mine-wrap')) ?? centerOf(spot);
        const win = mySettlements?.find((x) => x.type === t)?.net ?? mineAmt;
        if (to) representativeChips(Math.max(win, 10), 3).forEach((c, i) => fly(makeChipNode(c, 26), house, to, { duration: 560, arc: 80, delay: delay + i * 70, spin: 360 }));
      }
      if (othersAmt) {
        const to = centerOf(spot?.querySelector('.others-wrap')) ?? centerOf(spot);
        if (to) representativeChips(othersAmt, 2).forEach((c, i) => fly(makeChipNode(c, 20), house, to, { duration: 560, arc: 80, delay: delay + i * 70 }));
      }
    }
    delay += 800;
    // 3. 自己赢的 + 退回的 → 飞向余额
    for (const t of [...winners, ...pushes]) {
      const amt = confirmed[t] ?? 0; if (!amt) continue;
      const from = centerOf(document.querySelector(`.spot.${t} .mine-wrap`)) ?? centerOf(document.querySelector(`.spot.${t}`));
      const total = winners.has(t) ? amt + (mySettlements?.find((x) => x.type === t)?.net ?? 0) : amt;
      if (from) representativeChips(total, 4).forEach((c, i) => fly(makeChipNode(c, 24), from, wallet, { duration: 620, arc: 40, delay: delay + i * 60, scaleTo: 0.5 }));
    }
    delay += 700;
    setTimeout(() => setPaidOut(true), delay);
  };

  return (
    <div className={`table-page ${table.kind} ${orientation} ${wide ? 'wide' : ''} ${paidOut ? 'paid-out' : ''}`}>
      <header className="topbar">
        <Link to="/" className="ghost">‹ 返回大厅</Link>
        <div className="brand">{room ? <span className="room-badge">密码房</span> : null}{table.name}</div>
        <div className="userbar">
          <span>{user?.nickname}</span>
          <span className="balance">$ {user?.balance.toLocaleString()}</span>
          {room && <button className="ghost room-btn" onClick={() => setRoomPanel(true)}>{room.isOwner ? '房间管理' : '房间'}{room.locked ? ' 🔒' : ''}</button>}
          <button className={`ghost sound ${soundOn ? '' : 'off'}`} title="音效开关" onClick={() => setSoundOn(sound.toggle())}>{soundOn ? '音效' : '静音'}</button>
          <button className="ghost rotate" title="切换横竖屏" onClick={() => setOrientation(landscape ? 'portrait' : 'landscape')}>切屏</button>
        </div>
      </header>

      <div className="stage">
        <div className="scene">
          {table.kind === 'live'
            ? <LiveVideo whepUrl={table.stream?.whepUrl} dealerName={table.dealerName} />
            : <DealerScene flights={flights} onLanded={onLanded} shoeId={table.shoeId} />}

          {overlay && r && <SettleOverlay result={r} myNet={lastSettle} out={overlayOut} onClick={() => setOverlayOut(true)} />}
          <div className="limit-mark"><span className="lm-name">{table.name}<br /></span>限红 ${table.limits.minBet.toLocaleString()} – ${table.limits.maxBet.toLocaleString()}<br />边注 ${table.limits.maxSideBet.toLocaleString()}<br />第 {table.roundNo} 局</div>
          <PhaseBanner phase={table.phase} secs={secs} roundId={table.roundId} nextRoundAt={table.nextRoundAt ?? null} countdownEndsAt={table.countdownEndsAt} />
          <div className="hands">
            <Hand side="player" cards={cleared ? [] : table.playerCards} total={cleared ? 0 : table.playerTotal} win={showResult && !cleared ? r!.outcome === 'player' : false}
              landed={table.kind === 'rng' ? landed.player : undefined} squeeze={table.kind === 'live'} revealed={revealed} onReveal={reveal} />
            {/* 派彩阶段：阶段/胜方/输赢挪到牌桌右上角，中间留给开局倒计时（中间仍保留占位，庄闲位置不动） */}
            <div className={`phase-box ${table.phase === 'settling' ? 'corner' : ''}`}>
              <div className={`phase ${table.phase} ${betting && secs <= 5 ? 'closing' : ''}`}>{betting ? (secs <= 5 ? '确认下注' : `投注 ${secs}s`) : PHASE_LABEL[table.phase]}</div>
              {showResult && <div className={`outcome ${r!.outcome}`}>{r!.outcome === 'banker' ? '庄赢' : r!.outcome === 'player' ? '闲赢' : '和局'}</div>}
              {lastSettle !== null && <div className={`settle ${lastSettle >= 0 ? 'win' : 'lose'}`}>{lastSettle >= 0 ? '+' : ''}{lastSettle.toLocaleString()}</div>}
            </div>
            {table.phase === 'settling' && <div className="phase-box placeholder" aria-hidden />}
            <Hand side="banker" cards={cleared ? [] : table.bankerCards} total={cleared ? 0 : table.bankerTotal} win={showResult && !cleared ? r!.outcome === 'banker' : false}
              landed={table.kind === 'rng' ? landed.banker : undefined} squeeze={table.kind === 'live'} revealed={revealed} onReveal={reveal} />
          </div>
        </div>

        <aside className="side">
          <div className="players">
            <div className="panel-title">玩家押注 / 输赢 <span className="muted small">按流水排序 · 在线 {table.playersOnline}</span></div>
            <Leaderboard rows={table.leaderboard} me={user?.id} />
          </div>
          {wide && <RoadmapPanel rm={table.roadmap} compact />}
        </aside>
      </div>

      <div className={`bet-area ${betting ? 'open' : 'closed'}`}>
        <button className="help-btn" title="玩法说明" onClick={() => setHelp(true)}>?</button>
        {help && <BetHelp payouts={table.payouts} onClose={() => setHelp(false)} />}
        {roomPanel && room && <RoomPanel room={room} onClose={() => setRoomPanel(false)} onRoomChange={setRoom} onBalance={(b) => setUser(user ? { ...user, balance: b } : user)} />}
        <div className="bet-grid">
          <div className="side-row">
            {SIDE.slice(0, 3).map((t) => <BetSpot key={t} t={t} table={table} confirmed={confirmed[t]} pending={pending[t]} others={others[t]} allIn={pendingAllIn || myAllIn} onClick={() => addChip(t)} disabled={!betting} />)}
          </div>
          <div className="main-row">
            {MAIN.map((t) => <BetSpot key={t} t={t} table={table} confirmed={confirmed[t]} pending={pending[t]} others={others[t]} allIn={pendingAllIn || myAllIn} onClick={() => addChip(t)} disabled={!betting} big />)}
          </div>
          <div className="side-row">
            {SIDE.slice(3).map((t) => <BetSpot key={t} t={t} table={table} confirmed={confirmed[t]} pending={pending[t]} others={others[t]} allIn={pendingAllIn || myAllIn} onClick={() => addChip(t)} disabled={!betting} />)}
          </div>
        </div>
        <div className="chips">
          {CHIPS.map((c, i) => (
            <button key={c} className={`chip c${c} ${chip === c ? 'sel' : ''}`}
              onClick={() => { if (c !== chip) sound.chipPick(CHIPS.length > 1 ? i / (CHIPS.length - 1) : 0.5); setChip(c); }}>
              {chipLabel(c)}
            </button>
          ))}
          <div className="actions">
            <button onClick={undoLast} disabled={!betting || total(shown) === 0} className="ghost">撤注</button>
            <button onClick={submit} disabled={!betting || total(pending) === 0} className={`primary confirm ${total(pending) > 0 ? 'pulse' : ''} ${pendingAllIn ? 'allin' : ''}`}>
              {pendingAllIn ? `梭哈 $${total(pending).toLocaleString()}` : `确认 $${total(pending).toLocaleString()}`}
            </button>
            <button onClick={rebet} disabled={!betting || !lastBets} className="ghost">重复</button>
          </div>
          <div className={`bet-hint ${total(pending) > 0 ? 'active' : ''}`}>
            {total(pending) > 0
              ? <>已选 <b>${total(pending).toLocaleString()}</b>，点「{pendingAllIn ? '梭哈' : '确认'}」才算下注 · 剩 {secs}s</>
              : betting
                ? <>选筹码后点击投注区，再按确认 · 可用 ${available.toLocaleString()}{available > 0 && <button className="link" onClick={allInNow}>梭哈</button>}</>
                : <span className="muted">限红 {table.limits.minBet} – {table.limits.maxBet.toLocaleString()} · 边注上限 {table.limits.maxSideBet.toLocaleString()}</span>}
          </div>
        </div>
      </div>

      {!wide && <RoadmapPanel rm={table.roadmap} />}
      {toast && <div className="toast">{toast}</div>}
      {offline && <div className="net-badge">连接中断，正在重连…</div>}
    </div>
  );
}

function BetSpot({ t, table, confirmed, pending, others, allIn, onClick, disabled, big }: {
  t: BetType; table: TableSnapshot; confirmed?: number; pending?: number; others?: { amount: number; players: number };
  allIn: boolean; onClick: () => void; disabled: boolean; big?: boolean;
}) {
  const r = table.lastResult;
  const hit = table.phase === 'settling' && r ? isWinning(t, r) : false;
  const mine = (confirmed ?? 0) + (pending ?? 0);
  return (
    <button className={`spot ${t} ${big ? 'main-spot' : ''} ${hit ? 'hit' : ''} ${pending ? 'has-pending' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="spot-name">{BET_LABELS[t]}</span>
      <span className="spot-odds">{payoutLabel(t, table.payouts)}</span>
      {others && others.amount > 0 && (
        <span className="others-wrap" title={`${others.players} 位玩家共 $${others.amount.toLocaleString()}`}>
          <ChipStack amount={others.amount} others size={big ? 16 : 13} />
          <span className="others-count">{others.players}人</span>
        </span>
      )}
      <span className="mine-wrap">
        {confirmed ? <ChipStack amount={confirmed} size={big ? 30 : 22} /> : null}
        {pending ? <ChipStack amount={pending} ghost size={big ? 30 : 22} /> : null}
      </span>
      {mine > 0 && (
        <span className={`spot-amount ${!confirmed ? 'ghost' : ''}`}>
          {confirmed ? confirmed.toLocaleString() : ''}{pending ? <i>{confirmed ? ' +' : ''}{pending.toLocaleString()}</i> : ''}
        </span>
      )}
      {allIn && mine > 0 && <span className="allin-badge">ALL IN</span>}
    </button>
  );
}

function isWinning(t: BetType, r: NonNullable<TableSnapshot['lastResult']>): boolean {
  const n = r.playerCardCount + r.bankerCardCount;
  switch (t) {
    case 'player': return r.outcome === 'player';
    case 'banker': return r.outcome === 'banker';
    case 'tie': return r.outcome === 'tie';
    case 'playerPair': return r.playerPair;
    case 'bankerPair': return r.bankerPair;
    case 'anyPair': return r.playerPair || r.bankerPair;
    case 'perfectPair': return (r.playerPair && r.playerCards[0].suit === r.playerCards[1].suit) || (r.bankerPair && r.bankerCards[0].suit === r.bankerCards[1].suit);
    case 'lucky6': return r.outcome === 'banker' && r.bankerTotal === 6;
    case 'lucky7': return r.outcome === 'banker' && r.bankerTotal === 7;
    case 'big': return n >= 5;
    case 'small': return n === 4;
  }
}

function Hand({ side, cards, total, win, landed, squeeze, revealed, onReveal }: {
  side: 'player' | 'banker'; cards: Card[]; total: number; win: boolean;
  landed?: number; squeeze?: boolean; revealed: Set<string>; onReveal: (k: string) => void;
}) {
  // 点数：RNG 桌按已落桌的牌算；咪牌桌按已翻开的牌算，全部翻开前不剧透
  const visibleCards = landed !== undefined ? cards.slice(0, landed) : cards;
  const allRevealed = squeeze ? cards.every((_, i) => revealed.has(side + i)) : true;
  const showTotal = cards.length > 0 && (landed === undefined || landed >= cards.length) && allRevealed;
  const unrevealed = squeeze ? cards.filter((_, i) => !revealed.has(side + i)).length : 0;
  return (
    <div className={`hand ${side} ${win ? 'win' : ''}`}>
      {/* 标题做成固定水印，点数是独立角标：牌数 / 结果变化时标题位置不动 */}
      <div className="hand-title">{side === 'player' ? '闲 PLAYER' : '庄 BANKER'}</div>
      <div className={`hand-total ${showTotal ? 'show' : ''}`}>{showTotal ? total : ''}</div>
      {unrevealed > 0 && <span className="squeeze-hint">咪牌 · 拖动牌角掀开</span>}
      <div className="cards">
        {cards.map((c, i) => {
          if (landed !== undefined && i >= landed) return <div key={i} className="card-slot arriving" />;
          if (squeeze) return <SqueezeCard key={i} card={c} rotated={i === 2} revealed={revealed.has(side + i)} onReveal={() => onReveal(side + i)} />;
          return <PlayingCard key={i} c={c} rotated={i === 2} />;
        })}
        {cards.length === 0 && <div className="card-slot" />}
      </div>
      <span hidden>{visibleCards.length}</span>
    </div>
  );
}

function PlayingCard({ c, rotated }: { c: Card; rotated?: boolean }) {
  return <div className={`card ${rotated ? 'rot' : ''}`}><CardFace card={c} /></div>;
}

const TOP_N = 10;

/** 自己永远置顶并高亮（保留真实名次）；其他玩家显示前 10，其余折叠 */
function Leaderboard({ rows, me }: { rows: LeaderboardEntry[]; me?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!rows.length) return <div className="muted small pad">暂无玩家下注</div>;
  const ranked = rows.map((r, i) => ({ r, rank: i + 1 }));
  const mine = ranked.find((x) => x.r.userId === me);
  const others = ranked.filter((x) => x.r.userId !== me);
  const shown = expanded ? others : others.slice(0, TOP_N);
  const hidden = others.length - TOP_N;
  const Row = ({ r, rank }: { r: LeaderboardEntry; rank: number }) => (
    <tr className={r.userId === me ? 'me' : ''}>
      <td>{rank}</td>
      <td>{r.userId === me ? <b>{r.nickname}</b> : r.nickname}</td>
      <td className="bets-cell">
        {r.allIn && <span className="tag allin">梭哈</span>}
        {Object.entries(r.currentBets).map(([k, v]) => <span key={k} className={`tag ${k}`}>{BET_LABELS[k as BetType]} {v}</span>)}
      </td>
      <td>{r.wagered.toLocaleString()}</td>
      <td className={r.net > 0 ? 'win' : r.net < 0 ? 'lose' : ''}>{r.net > 0 ? '+' : ''}{r.net.toLocaleString()}</td>
    </tr>
  );
  return (
    <table className="lb">
      <thead><tr><th>#</th><th>玩家</th><th>本局押注</th><th>流水</th><th>输赢</th></tr></thead>
      <tbody>
        {mine && <Row r={mine.r} rank={mine.rank} />}
        {shown.map((x) => <Row key={x.r.userId} r={x.r} rank={x.rank} />)}
        {hidden > 0 && (
          <tr className="lb-more">
            <td colSpan={5}>
              <button className="link" onClick={() => setExpanded((e) => !e)}>
                {expanded ? '收起' : `展开其余 ${hidden} 位玩家 ▾`}
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
