/**
 * 私人房间管理面板（房主）/ 房间信息（成员）
 *  - 成员列表：在线、本房流水 / 输赢 / 局数、房主给的上下分
 *  - 房主：给成员上分 / 下分（房主与成员之间转账）、改限红、上锁 / 开锁、导出账单 CSV、移除成员、关闭房间
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { RoomInfo, RoomMember } from '../lib/protocol';
import { native } from '../lib/native';

const money = (n: number) => (n ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const signed = (n: number) => (n > 0 ? '+' : '') + money(n);

export function RoomPanel({ room: initial, onClose, onRoomChange, onBalance }: {
  room: RoomInfo; onClose: () => void; onRoomChange: (r: RoomInfo) => void; onBalance?: (b: number) => void;
}) {
  const [room, setRoom] = useState(initial);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [limits, setLimits] = useState({ minBet: initial.limits.minBet, maxBet: initial.limits.maxBet, maxSideBet: initial.limits.maxSideBet });
  const [adjust, setAdjust] = useState<{ userId: number; amount: string } | null>(null);

  const load = useCallback(() => {
    api.roomMembers(room.id).then((r) => setMembers(r.items)).catch((e) => setErr(e.message));
    api.room(room.id).then((r) => { setRoom(r); onRoomChange(r); }).catch(() => {});
  }, [room.id, onRoomChange]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const toggleLock = () => run(async () => { const r = await api.updateRoom(room.id, { locked: !room.locked }); setRoom(r); onRoomChange(r); });
  const saveLimits = () => run(async () => { const r = await api.updateRoom(room.id, limits); setRoom(r); onRoomChange(r); });
  const doAdjust = (sign: 1 | -1) => run(async () => {
    if (!adjust) return;
    const v = Number(adjust.amount);
    if (!(v > 0)) throw new Error('请输入金额');
    const r = await api.roomTransfer(room.id, adjust.userId, sign * v);
    onBalance?.(r.ownerBalance);
    setAdjust(null);
    native.vibrate();
  });
  const kick = (m: RoomMember) => { if (confirm(`移除成员「${m.nickname}」？`)) run(() => api.kickMember(room.id, m.userId)); };
  const close = () => { if (confirm('关闭房间后所有人将退出，账单仍可在后台查询。确定关闭？')) run(async () => { await api.closeRoom(room.id); onClose(); location.href = '/'; }); };
  const copyPwd = () => { if (room.password) { native.setClipboard?.(room.password); try { navigator.clipboard?.writeText(room.password); } catch { /* ignore */ } } };

  const totals = members.reduce((a, m) => ({ wagered: a.wagered + m.wagered, net: a.net + m.net }), { wagered: 0, net: 0 });

  return (
    <div className="help-mask" onClick={onClose}>
      <div className="help-dialog room-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <b>{room.name}</b>
          <span className="muted small">
            房主 {room.ownerName} · {room.members}/{room.capacity} 人 · 在线 {room.online}{room.locked ? ' · 已上锁' : ''}
          </span>
          <button className="help-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="help-list room-body">
          {err && <div className="error" onClick={() => setErr('')}>{err}</div>}

          {room.isOwner && (
            <div className="room-owner">
              <div className="room-row">
                <span className="muted small">房间密码</span>
                <b className="room-pwd">{room.password}</b>
                <button className="ghost small-btn" onClick={copyPwd}>复制</button>
                <span className="grow" />
                <button className={`small-btn ${room.locked ? 'primary' : 'ghost'}`} disabled={busy} onClick={toggleLock}>{room.locked ? '开锁（允许新成员进入）' : '上锁（禁止新成员进入）'}</button>
              </div>
              <div className="room-row">
                <span className="muted small">限红</span>
                <input type="number" value={limits.minBet} onChange={(e) => setLimits({ ...limits, minBet: Number(e.target.value) })} placeholder="最低" />
                <span className="muted">–</span>
                <input type="number" value={limits.maxBet} onChange={(e) => setLimits({ ...limits, maxBet: Number(e.target.value) })} placeholder="最高" />
                <span className="muted small">边注</span>
                <input type="number" value={limits.maxSideBet} onChange={(e) => setLimits({ ...limits, maxSideBet: Number(e.target.value) })} placeholder="边注上限" />
                <button className="primary small-btn" disabled={busy} onClick={saveLimits}>保存</button>
                <span className="muted small">下一局生效</span>
              </div>
              <div className="room-row">
                <a className="ghost small-btn link-btn" href={api.roomLedgerUrl(room.id)} target="_blank" rel="noreferrer">导出账单 CSV</a>
                <span className="muted small">本房累计流水 {money(totals.wagered)} · 玩家输赢 {signed(totals.net)}（正数=玩家赢）</span>
                <span className="grow" />
                <button className="ghost small-btn danger" disabled={busy} onClick={close}>关闭房间</button>
              </div>
            </div>
          )}

          <table className="tbl room-members">
            <thead><tr><th>成员</th><th>状态</th><th>流水</th><th>输赢</th><th>局数</th>{room.isOwner && <><th>上分/下分</th><th>余额</th><th></th></>}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className={m.isOwner ? 'owner' : ''}>
                  <td>{m.nickname}{m.isOwner && <span className="tag gold-tag">房主</span>}{m.username && <div className="muted small">{m.username}</div>}</td>
                  <td><span className={`dot ${m.online ? 'on' : ''}`} />{m.online ? '在线' : '离线'}</td>
                  <td>{money(m.wagered)}</td>
                  <td className={m.net > 0 ? 'win' : m.net < 0 ? 'lose' : ''}>{signed(m.net)}</td>
                  <td>{m.rounds}</td>
                  {room.isOwner && (
                    <>
                      <td className="muted small">{m.isOwner ? '—' : `+${money(m.up)} / -${money(m.down)}`}</td>
                      <td>{money(m.balance ?? 0)}</td>
                      <td className="room-actions">
                        {!m.isOwner && (adjust?.userId === m.userId
                          ? <span className="adjust-inline">
                              <input type="number" autoFocus placeholder="金额" value={adjust.amount} onChange={(e) => setAdjust({ userId: m.userId, amount: e.target.value })} />
                              <button className="primary small-btn" disabled={busy} onClick={() => doAdjust(1)}>上分</button>
                              <button className="ghost small-btn" disabled={busy} onClick={() => doAdjust(-1)}>下分</button>
                              <button className="ghost small-btn" onClick={() => setAdjust(null)}>取消</button>
                            </span>
                          : <>
                              <button className="ghost small-btn" onClick={() => setAdjust({ userId: m.userId, amount: '' })}>上下分</button>
                              <button className="ghost small-btn danger" onClick={() => kick(m)}>移除</button>
                            </>)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted small room-note">
            上分 = 从房主余额转给成员；下分 = 从成员余额转回房主，用的都是通用积分。所有转账都记入双方流水，后台可查。人数上限 {room.capacity}，满员后新成员无法进入。
          </div>
        </div>
      </div>
    </div>
  );
}
