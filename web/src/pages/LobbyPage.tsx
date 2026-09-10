import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Hall, TableSummary } from '../lib/protocol';
import { BigRoad } from '../components/Roadmap';
import { useSession } from '../App';
import { useCountdown, PHASE_LABEL } from '../lib/useCountdown';

export function LobbyPage() {
  const { user, logout, setUser } = useSession();
  const [halls, setHalls] = useState<Hall[]>([]);
  const [active, setActive] = useState('lobby');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => api.halls().then((r) => alive && setHalls(r.halls)).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 3000); // 大厅列表轮询；牌桌内改用 WebSocket
    return () => { alive = false; clearInterval(t); };
  }, []);

  const hall = halls.find((h) => h.id === active) ?? halls[0];

  const deposit = async () => {
    const r = await api.deposit(10000);
    setUser(user ? { ...user, balance: r.balance } : user);
  };

  return (
    <div className="lobby">
      <header className="topbar">
        <div className="brand">百家乐 <span className="gold">Baccarat</span></div>
        <nav className="hall-tabs">
          {halls.map((h) => (
            <button key={h.id} className={`${h.id === hall?.id ? 'active' : ''} ${h.kind}`} onClick={() => setActive(h.id)}>
              {h.kind === 'vip' ? '♛ ' : ''}{h.name}{h.locked ? ' 🔒' : ''}
            </button>
          ))}
        </nav>
        <div className="userbar">
          <span>{user?.nickname}</span>
          <span className="vip">VIP{user?.vipLevel}</span>
          <span className="balance">$ {user?.balance.toLocaleString()}</span>
          {user?.role === 'admin' && <Link to="/admin" className="ghost">管理后台</Link>}
          <button onClick={deposit} className="ghost">充值(演示)</button>
          <button onClick={logout} className="ghost">退出</button>
        </div>
      </header>
      {err && <div className="error">{err}</div>}
      {hall && (
        <section className="hall">
          <div className="hall-head">
            <h2>{hall.name}</h2>
            <span className="muted">
              {hall.kind === 'lobby' ? 'RNG 自动派牌 · 12 秒一局' : `真人荷官 · 实况视频 · 需 VIP${hall.minVipLevel}`}
              {hall.locked && ' · 您的等级不足，仅可观看'}
            </span>
          </div>
          <div className="table-grid">
            {hall.tables.map((t) => <TableCard key={t.id} t={t} locked={hall.locked} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function TableCard({ t, locked }: { t: TableSummary; locked: boolean }) {
  const secs = useCountdown(t.countdownEndsAt);
  const inner = (
    <div className={`table-card ${t.kind} ${locked ? 'locked' : ''}`}>
      <div className="tc-head">
        <b>{t.name}</b>
        <span className={`phase ${t.phase}`}>{t.phase === 'betting' ? `投注 ${secs}s` : PHASE_LABEL[t.phase]}</span>
      </div>
      <div className="tc-road"><BigRoad cols={t.bigRoad} leadingTies={0} cell={14} minCols={14} /></div>
      <div className="tc-foot">
        <span>{t.dealerName ? `荷官 ${t.dealerName}` : 'RNG'}</span>
        <span>限红 {t.limits.minBet}-{t.limits.maxBet.toLocaleString()}</span>
        <span>👤 {t.playersOnline}</span>
        <span className="mini-stats">
          <i style={{ color: '#d62828' }}>庄{t.stats.banker}</i> <i style={{ color: '#1d5fd6' }}>闲{t.stats.player}</i> <i style={{ color: '#2a9d4f' }}>和{t.stats.tie}</i>
        </span>
      </div>
    </div>
  );
  return locked ? inner : <Link to={`/table/${t.id}`} className="plain">{inner}</Link>;
}
