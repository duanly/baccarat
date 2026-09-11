import { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, auth } from './lib/api';
import { socket } from './lib/ws';
import type { User } from './lib/protocol';
import { native } from './lib/native';
import { AuthPage } from './pages/AuthPage';
import { LobbyPage } from './pages/LobbyPage';
import { TablePage } from './pages/TablePage';
import { AdminPage } from './pages/AdminPage';

interface Session { user: User | null; setUser: (u: User | null) => void; logout: () => void; refresh: () => Promise<void> }
export const SessionCtx = createContext<Session>(null!);
export const useSession = () => useContext(SessionCtx);

function Shell() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const nav = useNavigate();

  const refresh = async () => {
    if (!auth.token) { setUser(null); return; }
    try { setUser((await api.me()).user); } catch { auth.token = null; setUser(null); }
  };

  useEffect(() => {
    auth.restore().then(() => refresh()).finally(() => { setReady(true); socket.connect(); });
    // App 从后台切回：重连 WS、刷新余额
    return native.onLifecycle((s) => { if (s === 'resumed') { socket.connect(); socket.reauth(); refresh(); } });
  }, []);

  // 结算 / 下注 / 后台上下分推送 → 更新余额
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = socket.on((m) => {
      if ((m.type === 'settled' || m.type === 'bet:ok' || m.type === 'balance') && typeof m.balance === 'number')
        setUser((u) => (u ? { ...u, balance: m.balance } : u));
      if (m.type === 'balance' && typeof m.amount === 'number' && m.amount !== 0) {
        const label = m.kind === 'transfer' ? (m.amount > 0 ? '房主上分' : '房主下分') : (m.amount > 0 ? '已充值' : '已扣款');
        setNotice(`${label} ${m.amount > 0 ? '+' : ''}${m.amount.toLocaleString()}，余额 $ ${m.balance.toLocaleString()}`);
        clearTimeout(timer); timer = setTimeout(() => setNotice(''), 4000);
      }
    });
    return () => { off(); clearTimeout(timer); };
  }, []);

  const logout = () => { auth.token = null; setUser(null); nav('/login'); };

  if (!ready) return <div className="center muted">加载中…</div>;
  return (
    <SessionCtx.Provider value={{ user, setUser, logout, refresh }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <AuthPage />} />
        <Route path="/" element={user ? <LobbyPage /> : <Navigate to="/login" />} />
        <Route path="/table/:id" element={user ? <TablePage /> : <Navigate to="/login" />} />
        <Route path="/admin/*" element={user?.role === 'admin' ? <AdminPage /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      {notice && <div className="balance-notice" onClick={() => setNotice('')}>{notice}</div>}
    </SessionCtx.Provider>
  );
}

export default function App() {
  return <BrowserRouter><Shell /></BrowserRouter>;
}
