/**
 * VIP 厅实况视频：WebRTC WHEP 拉流（SRS / mediamtx / Cloudflare Stream 均支持 WHEP）
 * 荷官端：摄像头 → OBS/WHIP 推流 → 媒体服务器 → 浏览器 WHEP 播放，延迟通常 < 1s。
 * 拉流失败时显示占位画面（本地无媒体服务器时即为此状态）。
 */
import { useEffect, useRef, useState } from 'react';

export function LiveVideo({ whepUrl, dealerName }: { whepUrl?: string; dealerName?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');

  useEffect(() => {
    if (!whepUrl) { setStatus('offline'); return; }
    let pc: RTCPeerConnection | null = new RTCPeerConnection();
    let cancelled = false;
    setStatus('connecting');

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (ev) => {
      if (videoRef.current && ev.streams[0]) {
        videoRef.current.srcObject = ev.streams[0];
        setStatus('live');
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) setStatus('offline');
    };

    (async () => {
      try {
        const offer = await pc!.createOffer();
        await pc!.setLocalDescription(offer);
        const res = await fetch(whepUrl, { method: 'POST', headers: { 'content-type': 'application/sdp' }, body: offer.sdp });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);
        const answer = await res.text();
        if (cancelled) return;
        await pc!.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch {
        if (!cancelled) setStatus('offline');
      }
    })();

    return () => { cancelled = true; pc?.close(); pc = null; };
  }, [whepUrl]);

  return (
    <div className="video">
      <video ref={videoRef} autoPlay playsInline muted style={{ display: status === 'live' ? 'block' : 'none' }} />
      {status !== 'live' && (
        <div className="video-placeholder">
          <div className="dealer-avatar">{(dealerName ?? 'D')[0]}</div>
          <div>荷官 {dealerName ?? ''}</div>
          <div className="muted">{status === 'connecting' ? '正在连接实况视频…' : '视频离线（未连接媒体服务器）'}</div>
        </div>
      )}
      <span className={`live-badge ${status}`}>{status === 'live' ? 'LIVE' : status === 'connecting' ? '…' : 'OFFLINE'}</span>
    </div>
  );
}
