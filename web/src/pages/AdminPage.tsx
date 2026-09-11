/**
 * 玩家管理后台：总览 → 玩家列表（搜索 / 组别 / 在线 / 状态 / 排序）→ 玩家详情抽屉
 *（统计、上下分、组别与状态、上下分日志、下注输赢日志、登录会话）
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { admin } from '../lib/api';
import { BET_LABELS, type BetType } from '../lib/protocol';
import { useSession } from '../App';

const fmtMoney = (n: number) => (n ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const fmtSigned = (n: number) => (n > 0 ? '+' : '') + fmtMoney(n);
const fmtTime = (t?: number | null) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—');
const fmtDur = (ms: number) => {
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const cls = (n: number) => (n > 0 ? 'win' : n < 0 ? 'lose' : '');

export function AdminPage() {
  const { user, logout } = useSession();
  const [summary, setSummary] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [filters, setFilters] = useState({ q: '', group: '', online: false, status: '', sort: 'wagered', dir: 'desc', page: 1 });
  const [list, setList] = useState<{ total: number; items: any[] }>({ total: 0, items: [] });
  const [selected, setSelected] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'players' | 'tables' | 'rooms'>('players');

  const loadGroups = useCallback(() => admin.groups().then((r) => setGroups(r.items)).catch((e) => setErr(e.message)), []);
  const loadList = useCallback(() => {
    admin.players({ ...filters, online: filters.online ? 1 : '', size: 50 }).then(setList).catch((e) => setErr(e.message));
  }, [filters]);

  useEffect(() => { loadGroups(); admin.summary().then(setSummary).catch(() => {}); }, [loadGroups]);
  useEffect(() => { loadList(); const t = setInterval(loadList, 10_000); return () => clearInterval(t); }, [loadList]);

  const setF = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const sortBy = (k: string) => setF({ sort: k, dir: filters.sort === k && filters.dir === 'desc' ? 'asc' : 'desc' });
  const Th = ({ k, children }: { k?: string; children: React.ReactNode }) => (
    <th className={k ? 'sortable' : ''} onClick={k ? () => sortBy(k) : undefined}>
      {children}{k && filters.sort === k ? (filters.dir === 'desc' ? ' ▾' : ' ▴') : ''}
    </th>
  );

  // 新建组别：用内嵌输入框（App 的 WebView 里 prompt() 会被静默吞掉）
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const addGroup = async () => {
    const name = (newGroup ?? '').trim();
    if (!name) return;
    try { await admin.createGroup(name); setNewGroup(null); loadGroups(); } catch (e: any) { setErr(e.message); }
  };
  const removeGroup = async (g: any) => {
    if (!confirm(`删除组别「${g.name}」？组内玩家会变成未分组。`)) return;
    try { await admin.deleteGroup(g.id); loadGroups(); loadList(); } catch (e: any) { setErr(e.message); }
  };

  const pages = Math.max(1, Math.ceil(list.total / 50));

  return (
    <div className="admin">
      <header className="topbar">
        <Link to="/" className="ghost">‹ 大厅</Link>
        <div className="brand">玩家管理 <span className="muted small">Admin</span></div>
        <div className="hall-tabs">
          <button className={view === 'players' ? 'active' : ''} onClick={() => setView('players')}>玩家</button>
          <button className={view === 'tables' ? 'active' : ''} onClick={() => setView('tables')}>牌桌设置</button>
          <button className={view === 'rooms' ? 'active' : ''} onClick={() => setView('rooms')}>私人房间{summary?.roomsActive ? `（${summary.roomsActive}）` : ''}</button>
        </div>
        <div className="userbar"><span>{user?.nickname}</span><button className="ghost" onClick={logout}>退出</button></div>
      </header>

      {view === 'tables' && <TableSettings onError={setErr} />}
      {view === 'rooms' && <RoomsAdmin onError={setErr} />}
      {view === 'tables' && err && <div className="error" onClick={() => setErr('')}>{err}</div>}
      {view === 'players' && <>

      {summary && (
        <div className="stat-row">
          <Stat label="玩家总数" value={summary.players} sub={`今日新增 ${summary.newToday}`} />
          <Stat label="当前在线" value={summary.online} />
          <Stat label="今日流水" value={fmtMoney(summary.wageredToday)} />
          <Stat label="今日玩家输赢" value={fmtSigned(summary.playerNetToday)} tone={cls(summary.playerNetToday)} sub="正数=玩家赢" />
          <Stat label="今日上分 / 下分" value={`${fmtMoney(summary.depositToday)} / ${fmtMoney(summary.withdrawToday)}`} />
          <Stat label="玩家余额合计" value={fmtMoney(summary.totalBalance)} />
          <Stat label="私人房间" value={summary.roomsActive ?? 0} sub={`今日私房流水 ${fmtMoney(summary.wageredPrivateToday ?? 0)}`} />
        </div>
      )}
      {err && <div className="error" onClick={() => setErr('')}>{err}</div>}

      <div className="filters">
        <input placeholder="搜索 用户名 / 昵称 / IP / ID" value={filters.q} onChange={(e) => setF({ q: e.target.value })} />
        <select value={filters.group} onChange={(e) => setF({ group: e.target.value })}>
          <option value="">全部组别</option>
          <option value="0">未分组</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}（{g.members}）</option>)}
        </select>
        {newGroup === null
          ? <button className="ghost" onClick={() => setNewGroup('')}>+ 新建组别</button>
          : <span className="new-group">
              <input autoFocus placeholder="组别名称，如：代理A" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); if (e.key === 'Escape') setNewGroup(null); }} />
              <button className="primary" onClick={addGroup} disabled={!newGroup.trim()}>创建</button>
              <button className="ghost" onClick={() => setNewGroup(null)}>取消</button>
            </span>}
        {filters.group && Number(filters.group) > 0 && <button className="ghost danger" onClick={() => removeGroup(groups.find((g) => String(g.id) === filters.group))}>删除当前组</button>}
        <select value={filters.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="">全部状态</option><option value="active">正常</option><option value="frozen">已冻结</option>
        </select>
        <label className="chk"><input type="checkbox" checked={filters.online} onChange={(e) => setF({ online: e.target.checked })} /> 仅在线</label>
        <span className="muted small">共 {list.total} 人</span>
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <Th k="id">ID</Th><Th>玩家</Th><Th>组别</Th><Th>状态</Th><Th k="balance">余额</Th>
              <Th k="wagered">总流水</Th><Th k="net">总输赢</Th><Th k="bets">注数 / 均注</Th><Th>上分 / 下分</Th>
              <Th>设备</Th><Th>IP</Th><Th k="lastLogin">最近登录</Th><Th k="online">在线时长</Th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((p) => (
              <tr key={p.id} className={selected === p.id ? 'sel' : ''} onClick={() => setSelected(p.id)}>
                <td>{p.id}</td>
                <td><span className={`dot ${p.online ? 'on' : ''}`} />{p.nickname} <span className="muted small">{p.username} · VIP{p.vipLevel}{p.canHost ? ` · 房主(${p.maxRooms})` : ''}</span></td>
                <td>{p.groupName ?? <span className="muted">—</span>}</td>
                <td>{p.status === 'frozen' ? <span className="tag frozen">冻结</span> : <span className="tag ok">正常</span>}</td>
                <td className="num gold">{fmtMoney(p.balance)}</td>
                <td className="num">{fmtMoney(p.wagered)}</td>
                <td className={`num ${cls(p.net)}`}>{fmtSigned(p.net)}</td>
                <td className="num">{p.betCount} / {fmtMoney(p.avgBet)}</td>
                <td className="num">{fmtMoney(p.deposits)} / {fmtMoney(p.withdraws)}</td>
                <td className="small">{p.lastDevice ?? '—'}</td>
                <td className="mono small">{p.lastIp ?? '—'}</td>
                <td className="small">{fmtTime(p.lastLoginAt)}</td>
                <td className="num small">{fmtDur(p.totalOnlineMs)}</td>
              </tr>
            ))}
            {!list.items.length && <tr><td colSpan={13} className="muted center-text">没有匹配的玩家</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="ghost" disabled={filters.page <= 1} onClick={() => setF({ page: filters.page - 1 })}>上一页</button>
        <span>{filters.page} / {pages}</span>
        <button className="ghost" disabled={filters.page >= pages} onClick={() => setF({ page: filters.page + 1 })}>下一页</button>
      </div>

      {selected !== null && <PlayerDrawer id={selected} groups={groups} onClose={() => setSelected(null)} onChanged={() => { loadList(); admin.summary().then(setSummary).catch(() => {}); }} />}
      </>}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`}>{value}</div>
      {sub && <div className="stat-sub muted">{sub}</div>}
    </div>
  );
}

type Tab = 'stats' | 'adjust' | 'bets' | 'sessions';

function PlayerDrawer({ id, groups, onClose, onChanged }: { id: number; groups: any[]; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('stats');
  const [tx, setTx] = useState<any[]>([]);
  const [bets, setBets] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    admin.player(id).then(setData).catch((e) => setMsg(e.message));
    admin.transactions(id, 'deposit,withdraw').then((r) => setTx(r.items)).catch(() => {});
  }, [id]);
  useEffect(() => { setTab('stats'); load(); }, [load]);
  useEffect(() => {
    if (tab === 'bets') admin.bets(id).then((r) => setBets(r.items)).catch(() => {});
    if (tab === 'sessions') admin.sessions(id).then((r) => setSessions(r.items)).catch(() => {});
  }, [tab, id]);

  const doAdjust = async (sign: 1 | -1) => {
    const v = Number(amount);
    if (!(v > 0)) return setMsg('请输入金额');
    if (sign < 0 && !confirm(`确认给 ${data.player.nickname} 下分 ${fmtMoney(v)}？`)) return;
    setBusy(true); setMsg('');
    try {
      await admin.adjust(id, sign * v, note);
      setAmount(''); setNote('');
      setMsg(sign > 0 ? '上分成功' : '下分成功');
      load(); onChanged();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const patch = async (p: Record<string, unknown>) => {
    try { await admin.updatePlayer(id, p); load(); onChanged(); } catch (e: any) { setMsg(e.message); }
  };

  if (!data) return <div className="drawer"><div className="drawer-head"><b>加载中…</b><button className="ghost" onClick={onClose}>✕</button></div></div>;
  const { player: p, stats: s } = data;

  return (
    <div className="drawer">
      <div className="drawer-head">
        <div>
          <span className={`dot ${p.online ? 'on' : ''}`} /><b>{p.nickname}</b> <span className="muted small">{p.username} · ID {p.id} · 注册 {fmtTime(p.createdAt)}</span>
          <div className="small muted">{p.online ? `在线中 · ${data.current?.device ?? ''} · ${data.current?.ip ?? ''}` : `离线 · 最近登录 ${fmtTime(p.lastLoginAt)} · ${p.lastDevice ?? ''} · ${p.lastIp ?? ''}`}</div>
        </div>
        <button className="ghost" onClick={onClose}>✕</button>
      </div>

      <div className="drawer-controls">
        <label>组别
          <select value={p.groupId ?? ''} onChange={(e) => patch({ groupId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">未分组</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label>VIP
          <select value={p.vipLevel} onChange={(e) => patch({ vipLevel: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>VIP{v}</option>)}
          </select>
        </label>
        <label>房主权限
          <select value={p.canHost ? '1' : '0'} onChange={(e) => patch({ canHost: e.target.value === '1', ...(e.target.value === '1' && !p.maxRooms ? { maxRooms: 3 } : {}) })}>
            <option value="0">无</option>
            <option value="1">可开私人房</option>
          </select>
        </label>
        {p.canHost && (
          <label>最多开房
            <select value={p.maxRooms ?? 0} onChange={(e) => patch({ maxRooms: Number(e.target.value) })}>
              {[1, 2, 3, 5, 10, 20, 50].map((v) => <option key={v} value={v}>{v} 间</option>)}
            </select>
          </label>
        )}
        <button className={p.status === 'frozen' ? 'primary' : 'ghost danger'} onClick={() => patch({ status: p.status === 'frozen' ? 'active' : 'frozen' })}>
          {p.status === 'frozen' ? '解冻账号' : '冻结账号'}
        </button>
      </div>

      <div className="tabs slim">
        {(['stats', 'adjust', 'bets', 'sessions'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {{ stats: '数据统计', adjust: '上下分', bets: '下注日志', sessions: '登录记录' }[t]}
          </button>
        ))}
      </div>
      {msg && <div className="note">{msg}</div>}

      {tab === 'stats' && (
        <div className="drawer-body">
          <div className="kv-grid">
            <Kv k="当前余额" v={fmtMoney(p.balance)} tone="gold" />
            <Kv k="总流水" v={fmtMoney(s.wagered)} sub={`正常房 ${fmtMoney(s.wageredPublic ?? 0)} · 私房 ${fmtMoney(s.wageredPrivate ?? 0)}`} />
            <Kv k="总输赢" v={fmtSigned(s.net)} tone={cls(s.net)} sub={`正常房 ${fmtSigned(s.netPublic ?? 0)} · 私房 ${fmtSigned(s.netPrivate ?? 0)}`} />
            <Kv k="私房局数 / 注数" v={`${s.roundsPrivate ?? 0} / ${s.betsPrivate ?? 0}`} sub={`收到上分 ${fmtMoney(s.roomTransferIn ?? 0)} · 被下分 ${fmtMoney(s.roomTransferOut ?? 0)}`} />
            <Kv k="私房积分合计" v={fmtMoney(s.creditTotal ?? 0)} sub={(data.credits ?? []).map((c: any) => `${c.ownerName} ${fmtMoney(c.balance)}`).join(' · ') || '无'} />
            <Kv k="作为房主发出 / 收回" v={`${fmtMoney(s.roomGiven ?? 0)} / ${fmtMoney(s.roomTaken ?? 0)}`} sub="大厅积分 ↔ 成员私房积分" />
            <Kv k="累计上分" v={fmtMoney(s.deposits)} sub={`${s.depositCount} 次`} />
            <Kv k="累计下分" v={fmtMoney(s.withdraws)} sub={`${s.withdrawCount} 次`} />
            <Kv k="上下分净额" v={fmtSigned(s.netDepositFlow)} sub="上分 − 下分" />
            <Kv k="注数 / 局数" v={`${s.betCount} / ${s.rounds}`} />
            <Kv k="平均下注额" v={fmtMoney(s.avgBet)} sub={`单注最高 ${fmtMoney(s.maxBet)}`} />
            <Kv k="下注频率" v={`${s.roundsPerHour} 局/小时`} sub={`${s.betsPerHour} 注/小时`} />
            <Kv k="注单胜率" v={`${Math.round(s.winRate * 100)}%`} />
            <Kv k="总在线时长" v={fmtDur(s.onlineMs)} sub={`活跃 ${s.activeDays} 天`} />
            <Kv k="首次 / 最近下注" v={fmtTime(s.firstBetAt)} sub={fmtTime(s.lastBetAt)} />
          </div>
          <h4>各玩法分布</h4>
          <table className="grid compact">
            <thead><tr><th>玩法</th><th>注数</th><th>流水</th><th>输赢</th></tr></thead>
            <tbody>{data.byType.map((x: any) => (
              <tr key={x.bet_type}><td>{BET_LABELS[x.bet_type as BetType] ?? x.bet_type}</td><td className="num">{x.n}</td><td className="num">{fmtMoney(x.wagered)}</td><td className={`num ${cls(x.net)}`}>{fmtSigned(x.net)}</td></tr>
            ))}</tbody>
          </table>
          <h4>近 30 天</h4>
          <table className="grid compact">
            <thead><tr><th>日期</th><th>注数</th><th>流水</th><th>输赢</th></tr></thead>
            <tbody>{data.daily.map((x: any) => (
              <tr key={x.day}><td>{x.day}</td><td className="num">{x.bets}</td><td className="num">{fmtMoney(x.wagered)}</td><td className={`num ${cls(x.net)}`}>{fmtSigned(x.net)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'adjust' && (
        <div className="drawer-body">
          <div className="adjust-form">
            <input type="number" min="0" step="1" placeholder="金额" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input placeholder="备注（渠道 / 订单号 / 原因）" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="primary" disabled={busy} onClick={() => doAdjust(1)}>上分 +</button>
            <button className="ghost danger" disabled={busy} onClick={() => doAdjust(-1)}>下分 −</button>
          </div>
          <h4>上下分日志</h4>
          <table className="grid compact">
            <thead><tr><th>时间</th><th>类型</th><th>金额</th><th>变动后余额</th><th>操作员</th><th>备注</th></tr></thead>
            <tbody>{tx.map((t) => (
              <tr key={t.id}>
                <td className="small">{fmtTime(t.created_at)}</td>
                <td>{t.kind === 'deposit' ? <span className="tag ok">上分</span> : <span className="tag frozen">下分</span>}</td>
                <td className={`num ${cls(t.amount)}`}>{fmtSigned(t.amount)}</td>
                <td className="num">{fmtMoney(t.balance)}</td>
                <td className="small">{t.operator ?? (t.ref === 'signup bonus' ? '系统赠送' : t.ref === 'demo deposit' ? '玩家自助' : '—')}</td>
                <td className="small">{t.note ?? ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'bets' && (
        <div className="drawer-body">
          <table className="grid compact">
            <thead><tr><th>时间</th><th>桌 / 局</th><th>玩法</th><th>下注</th><th>结果</th><th>派彩</th><th>输赢</th></tr></thead>
            <tbody>{bets.map((b) => (
              <tr key={b.id}>
                <td className="small">{fmtTime(b.created_at)}</td>
                <td className="small">{b.table_id} #{b.round_no}</td>
                <td>{BET_LABELS[b.bet_type as BetType] ?? b.bet_type}</td>
                <td className="num">{fmtMoney(b.amount)}</td>
                <td className="small">{b.outcome ? `${{ banker: '庄', player: '闲', tie: '和' }[b.outcome as string]} ${b.player_total}:${b.banker_total}${b.player_pair ? ' 闲对' : ''}${b.banker_pair ? ' 庄对' : ''}` : '未结算'}</td>
                <td className="num">{b.returned == null ? '—' : fmtMoney(b.returned)}</td>
                <td className={`num ${cls(b.net ?? 0)}`}>{b.net == null ? '—' : fmtSigned(b.net)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="drawer-body">
          <table className="grid compact">
            <thead><tr><th>登录时间</th><th>下线时间</th><th>时长</th><th>IP</th><th>设备</th></tr></thead>
            <tbody>{sessions.map((x) => (
              <tr key={x.id}>
                <td className="small">{fmtTime(x.started_at)}</td>
                <td className="small">{x.ended_at ? fmtTime(x.ended_at) : <span className="win">在线中</span>}</td>
                <td className="num small">{fmtDur((x.ended_at ?? Date.now()) - x.started_at)}</td>
                <td className="mono small">{x.ip}</td>
                <td className="small" title={x.user_agent}>{x.device}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kv({ k, v, sub, tone }: { k: string; v: React.ReactNode; sub?: string; tone?: string }) {
  return <div className="kv"><div className="muted small">{k}</div><div className={`kv-v ${tone ?? ''}`}>{v}</div>{sub && <div className="muted small">{sub}</div>}</div>;
}


/** 牌桌参数：下注时长 / 发牌间隔 / 派彩停顿 / 限红，改完即存，下一局生效 */
function TableSettings({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = useState<{ halls: any[]; items: any[] } | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const load = useCallback(() => admin.tables().then(setData).catch((e) => onError(e.message)), [onError]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  if (!data) return <div className="center muted">加载中…</div>;

  const FIELDS: { k: string; label: string; unit: string; step?: number }[] = [
    { k: 'bettingSeconds', label: '下注时长', unit: '秒' },
    { k: 'dealIntervalMs', label: '发牌间隔', unit: '毫秒', step: 100 },
    { k: 'resultPauseSeconds', label: '派彩停顿', unit: '秒', step: 0.5 },
    { k: 'minBet', label: '最低注', unit: '$' },
    { k: 'maxBet', label: '最高注', unit: '$' },
    { k: 'maxSideBet', label: '边注上限', unit: '$' },
  ];
  const val = (t: any, k: string) => draft[t.id]?.[k] ?? t[k];
  const dirty = (t: any) => !!draft[t.id] && FIELDS.some((f) => draft[t.id][f.k] !== undefined && Number(draft[t.id][f.k]) !== t[f.k]);
  const save = async (t: any) => {
    setSaving(t.id);
    try {
      const patch: Record<string, number> = {};
      for (const f of FIELDS) patch[f.k] = Number(val(t, f.k));
      await admin.updateTable(t.id, patch);
      setDraft((d) => { const n = { ...d }; delete n[t.id]; return n; });
      await load();
    } catch (e: any) { onError(e.message); } finally { setSaving(null); }
  };
  const applyHall = async (t: any) => {
    if (!confirm(`把「${t.name}」的参数应用到同厅所有牌桌？`)) return;
    try { const r = await admin.applyHall(t.id, t.hallId); await load(); alert(`已更新 ${r.updated} 张牌桌`); } catch (e: any) { onError(e.message); }
  };

  return (
    <div className="table-settings">
      <div className="muted small" style={{ padding: '8px 16px' }}>修改后点「保存」立即写入，下一局开始生效（正在进行的倒计时不打断）。发牌间隔含飞牌动画，建议 1500–3000 毫秒；派彩停顿最少 4.5 秒（结算画面 1.5s + 开局倒计时 3s）。</div>
      {data.halls.map((h) => (
        <div key={h.id} className="ts-hall">
          <div className="panel-title">{h.name} <span className="muted small">{h.kind === 'vip' ? '真人荷官' : 'RNG 自动'}</span></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>牌桌</th><th>状态</th><th>在线</th>{FIELDS.map((f) => <th key={f.k}>{f.label}<span className="muted small">（{f.unit}）</span></th>)}<th></th></tr></thead>
              <tbody>
                {data.items.filter((t) => t.hallId === h.id).map((t) => (
                  <tr key={t.id} className={dirty(t) ? 'dirty' : ''}>
                    <td><b>{t.name}</b><div className="muted small">{t.id}</div></td>
                    <td><span className={`phase ${t.phase}`}>{t.phase}</span> <span className="muted small">第 {t.roundNo} 局</span></td>
                    <td>{t.online}</td>
                    {FIELDS.map((f) => (
                      <td key={f.k}>
                        <input type="number" step={f.step ?? 1} value={val(t, f.k)} className="ts-input"
                          onChange={(e) => setDraft((d) => ({ ...d, [t.id]: { ...d[t.id], [f.k]: e.target.value } }))} />
                      </td>
                    ))}
                    <td className="ts-actions">
                      <button className="primary" disabled={!dirty(t) || saving === t.id} onClick={() => save(t)}>{saving === t.id ? '保存中…' : '保存'}</button>
                      <button className="ghost" onClick={() => applyHall(t)} title="把这张桌的参数复制到同厅其他桌">应用到全厅</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}


/** 后台：私人房间列表（数量、状态、房主、成员、流水、输赢）+ 成员明细 */
function RoomsAdmin({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = useState<{ active: number; total: number; items: any[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const load = useCallback(() => admin.rooms().then(setData).catch((e) => onError(e.message)), [onError]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (open) admin.roomMembers(open).then((r) => setMembers(r.items)).catch((e) => onError(e.message)); }, [open, onError]);
  if (!data) return <div className="center muted">加载中…</div>;
  return (
    <div className="table-settings">
      <div className="muted small" style={{ padding: '8px 16px' }}>活跃 {data.active} 间 · 历史共 {data.total} 间。私人房的下注、流水、输赢与正常房分开统计（玩家详情里也分列）。</div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>房间</th><th>房主</th><th>状态</th><th>阶段</th><th>成员 / 在线</th><th>限红</th><th>局数</th><th>流水</th><th>玩家输赢</th><th>创建时间</th><th></th></tr></thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id} className={r.status !== 'active' ? 'muted' : ''}>
                <td><b>{r.name}</b><div className="muted small">{r.id}{r.status === 'active' ? ` · 密码 ${r.password}` : ''}</div></td>
                <td>{r.owner_name}</td>
                <td>{r.status === 'active' ? <span className="tag ok">{r.locked ? '已上锁' : '开放'}</span> : <span className="tag frozen">已关闭</span>}</td>
                <td><span className={`phase ${r.phase}`}>{r.phase}</span></td>
                <td>{r.members} / {r.online} 在线</td>
                <td>{fmtMoney(r.min_bet)} – {fmtMoney(r.max_bet)}</td>
                <td>{r.rounds}</td>
                <td>{fmtMoney(r.wagered)}</td>
                <td className={cls(r.playerNet)}>{fmtSigned(r.playerNet)}</td>
                <td className="muted small">{fmtTime(r.created_at)}</td>
                <td><button className="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? '收起' : '成员'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>成员</th><th>账号</th><th>余额</th><th>本房流水</th><th>本房输赢</th><th>局数</th><th>房主上分</th><th>房主下分</th><th>加入时间</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}><td>{m.nickname}{m.isOwner ? '（房主）' : ''}</td><td>{m.username}</td><td>{fmtMoney(m.balance)}</td><td>{fmtMoney(m.wagered)}</td><td className={cls(m.net)}>{fmtSigned(m.net)}</td><td>{m.rounds}</td><td>{fmtMoney(m.up)}</td><td>{fmtMoney(m.down)}</td><td className="muted small">{fmtTime(m.joinedAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
