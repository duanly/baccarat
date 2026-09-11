import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Hall, TableSummary, RoomInfo } from '../lib/protocol';
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
            <button key={h.id} className={`${h.id === hall?.id && active !== 'rooms' ? 'active' : ''} ${h.kind}`} onClick={() => setActive(h.id)}>
              {h.kind === 'vip' ? '♛ ' : ''}{h.name}{h.locked ? ' 🔒' : ''}
            </button>
          ))}
          <button className={`rooms ${active === 'rooms' ? 'active' : ''}`} onClick={() => setActive('rooms')}>🔑 密码房</button>
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
      {active === 'rooms' && <RoomsSection canHost={!!user?.canHost} maxRooms={user?.maxRooms ?? 0} />}
      {active !== 'rooms' && hall && (
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
        <span className={t.full ? 'full' : ''}>👤 {t.playersOnline}/{t.capacity ?? 12}{t.full ? ' 满房' : ''}</span>
        <span className="mini-stats">
          <i style={{ color: '#d62828' }}>庄{t.stats.banker}</i> <i style={{ color: '#1d5fd6' }}>闲{t.stats.player}</i> <i style={{ color: '#2a9d4f' }}>和{t.stats.tie}</i>
        </span>
      </div>
    </div>
  );
  return locked || t.full ? inner : <Link to={`/table/${t.id}`} className="plain">{inner}</Link>;
}


/** 密码房入口：输密码进房 + 我的房间 + VIP 创建房间 */
function RoomsSection({ canHost, maxRooms }: { canHost: boolean; maxRooms: number }) {
  const nav = useNavigate();
  const [pwd, setPwd] = useState('');
  const [mine, setMine] = useState<RoomInfo[]>([]);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', password: '', minBet: 50, maxBet: 20000, maxSideBet: 2000 });
  const [busy, setBusy] = useState(false);

  const load = () => api.myRooms().then((r) => setMine(r.items)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const join = async () => {
    setBusy(true); setErr('');
    try { const r = await api.joinRoom(pwd.trim()); nav(`/table/${r.id}`); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setErr('');
    try { const r = await api.createRoom(form); nav(`/table/${r.id}`); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="hall rooms-hall">
      <div className="hall-head"><h2>密码房</h2><span className="muted">凭密码进入私人房间 · 每房最多 12 人</span></div>
      {err && <div className="error" onClick={() => setErr('')}>{err}</div>}
      <div className="room-join">
        <input placeholder="输入房间密码" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && join()} maxLength={8} autoCapitalize="off" autoCorrect="off" />
        <button className="primary" disabled={busy || !pwd.trim()} onClick={join}>进入房间</button>
        {canHost && maxRooms > 0
          ? <button className="ghost" onClick={() => setCreating((v) => !v)}>{creating ? '收起' : `+ 创建房间（最多 ${maxRooms} 间）`}</button>
          : <span className="muted small">开房权限由管理员开通</span>}
      </div>
      {creating && (
        <div className="room-create">
          <input placeholder="房间名称（可选）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={16} />
          <input placeholder="房间密码：4–8 位字母或数字" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} maxLength={8} autoCapitalize="off" />
          <label>最低注 <input type="number" value={form.minBet} onChange={(e) => setForm({ ...form, minBet: Number(e.target.value) })} /></label>
          <label>最高注 <input type="number" value={form.maxBet} onChange={(e) => setForm({ ...form, maxBet: Number(e.target.value) })} /></label>
          <label>边注上限 <input type="number" value={form.maxSideBet} onChange={(e) => setForm({ ...form, maxSideBet: Number(e.target.value) })} /></label>
          <button className="primary" disabled={busy || !form.password} onClick={create}>创建并进入</button>
        </div>
      )}
      {mine.length > 0 && (
        <>
          <h3 className="muted small rooms-sub">我的房间</h3>
          <div className="table-grid">
            {mine.map((r) => (
              <Link key={r.id} to={`/table/${r.id}`} className="plain">
                <div className={`table-card room-card ${r.full ? 'locked' : ''}`}>
                  <div className="tc-head"><b>{r.name}</b><span className={`phase ${r.phase}`}>{r.isOwner ? '我的房' : `房主 ${r.ownerName}`}</span></div>
                  <div className="tc-foot">
                    <span>限红 {r.limits.minBet}-{r.limits.maxBet.toLocaleString()}</span>
                    <span className={r.full ? 'full' : ''}>👤 {r.online}/{r.capacity}{r.full ? ' 满房' : ''}</span>
                    <span>{r.locked ? '🔒 已上锁' : '开放'}</span>
                    {r.isOwner && <span className="gold">密码 {r.password}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
