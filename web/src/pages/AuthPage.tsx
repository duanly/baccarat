import { useState } from 'react';
import { api, auth } from '../lib/api';
import { socket } from '../lib/ws';
import { useSession } from '../App';

export function AuthPage() {
  const { setUser } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = mode === 'login' ? await api.login(username, password) : await api.register(username, password, nickname || undefined);
      auth.token = r.token;
      socket.reauth();
      setUser(r.user);
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>百家乐 <span className="gold">Baccarat</span></h1>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
        </div>
        <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
        <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
        {mode === 'register' && <label>昵称<input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="牌桌上显示的名字" /></label>}
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>{mode === 'login' ? '进入游戏' : '注册并进入'}</button>
        {mode === 'register' && <p className="muted small">演示环境：注册即赠送测试筹码</p>}
      </form>
    </div>
  );
}
