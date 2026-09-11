/**
 * 音效：全部用 Web Audio 实时合成，不依赖音频文件（壳 App / H5 都能用，包体不变大）。
 *
 *  card()      发牌：一声短促的"唰"（带通噪声 + 快速衰减）
 *  chipPlace() 押注：筹码推上桌的清脆一声（高频敲击 + 轻微滑动）
 *  chipBack()  撤注：筹码收回（下行两声）
 *  chipPay(n)  派彩：一串陶瓷筹码碰撞声（多枚随机音高的短促叮声）
 *  cheer()     胜利：欢呼（人群噪声起伏 + 上扬和弦）
 *  tick(urgent) 倒计时：滴答（最后 1 秒略高）
 *
 * iOS 必须在用户手势之后才能出声：首次 touch / click 时自动解锁。
 * 开关保存在 localStorage（baccarat.sound），默认开。
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
try { enabled = localStorage.getItem('baccarat.sound') !== 'off'; } catch { /* ignore */ }

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state !== 'running') void ctx.resume();
  return ctx;
}

/** 在用户手势里解锁：iOS 要求在手势回调里同步 resume，并且实际播放一段（静音）声音才算解锁 */
function unlockNow() {
  const c = ac(); if (!c) return;
  try {
    const buf = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination); src.start(0);
  } catch { /* ignore */ }
  void c.resume();
}
let unlocked = false;
export function unlockOnGesture() {
  if (unlocked) return;
  unlocked = true;
  // 每次手势都尝试 resume：iOS 切后台 / 来电后 AudioContext 会变成 interrupted，需要再次手势恢复
  const h = () => unlockNow();
  for (const ev of ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown']) window.addEventListener(ev, h, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void ctx?.resume(); });
}

export const sound = {
  get enabled() { return enabled; },
  set enabled(v: boolean) {
    enabled = v;
    try { localStorage.setItem('baccarat.sound', v ? 'on' : 'off'); } catch { /* ignore */ }
    if (v) ac();
  },
  toggle() { sound.enabled = !enabled; if (enabled) { unlockNow(); setTimeout(() => sound.chipPlace(), 50); } return enabled; },

  card() {
    const c = ac(); if (!c || !enabled) return;
    const t = c.currentTime;
    const noise = noiseBuffer(c, 0.18);
    const src = c.createBufferSource(); src.buffer = noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1800, t); bp.frequency.exponentialRampToValueAtTime(600, t + 0.16); bp.Q.value = 0.9;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    src.connect(bp).connect(g).connect(master!); src.start(t); src.stop(t + 0.2);
  },

  chipPlace() {
    const c = ac(); if (!c || !enabled) return;
    const t = c.currentTime;
    clink(c, t, 2600 + Math.random() * 600, 0.35, 0.09);
    clink(c, t + 0.03, 3900 + Math.random() * 800, 0.18, 0.06);
    // 轻微滑动
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 0.08);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const g = c.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    src.connect(hp).connect(g).connect(master!); src.start(t); src.stop(t + 0.1);
  },

  /** 撤注：筹码收回（下行的两声 + 短滑动） */
  chipBack() {
    const c = ac(); if (!c || !enabled) return;
    const t = c.currentTime;
    clink(c, t, 3200 + Math.random() * 400, 0.28, 0.07);
    clink(c, t + 0.07, 2100 + Math.random() * 300, 0.3, 0.1);
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 0.14);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(900, t + 0.13); bp.Q.value = 1;
    const g = c.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    src.connect(bp).connect(g).connect(master!); src.start(t); src.stop(t + 0.15);
  },

  chipPay(n = 6) {
    const c = ac(); if (!c || !enabled) return;
    const t = c.currentTime;
    const count = Math.max(3, Math.min(12, n));
    for (let i = 0; i < count; i++) {
      const at = t + i * (0.055 + Math.random() * 0.03);
      clink(c, at, 2400 + Math.random() * 1600, 0.28 + Math.random() * 0.15, 0.08 + Math.random() * 0.05);
    }
  },

  cheer() {
    const c = ac(); if (!c || !enabled) return;
    const t = c.currentTime;
    // 人群：两层带通噪声，起伏 1.4s
    for (const [f, q, vol] of [[900, 0.7, 0.35], [1800, 1.2, 0.18]] as const) {
      const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 1.6);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const lfo = c.createOscillator(); lfo.frequency.value = 5 + Math.random() * 3;
      const lfoG = c.createGain(); lfoG.gain.value = f * 0.15; lfo.connect(lfoG).connect(bp.frequency); lfo.start(t); lfo.stop(t + 1.6);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.25); g.gain.setValueAtTime(vol, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      src.connect(bp).connect(g).connect(master!); src.start(t); src.stop(t + 1.6);
    }
    // 上扬和弦（大三和弦琶音 + 高八度）
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = c.createGain(); const at = t + 0.05 + i * 0.09;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.22, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
      o.connect(g).connect(master!); o.start(at); o.stop(at + 0.75);
    });
  },

  tick(urgent = false) {
    const c = ac(); if (!c || !enabled) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = urgent ? 1320 : 990;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(urgent ? 0.22 : 0.16, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(master!); o.start(t); o.stop(t + 0.08);
  },
};

/** 一声陶瓷筹码碰撞：两个不谐和的正弦快速衰减 + 极短噪声 */
function clink(c: AudioContext, t: number, freq: number, vol: number, dur: number) {
  for (const [mul, v] of [[1, 1], [2.76, 0.45], [5.4, 0.2]] as const) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mul;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (mul === 1 ? 1 : 0.6));
    o.connect(g).connect(master!); o.start(t); o.stop(t + dur + 0.02);
  }
  const src = c.createBufferSource(); src.buffer = noiseBuffer(c, 0.02);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
  const g = c.createGain(); g.gain.setValueAtTime(vol * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  src.connect(hp).connect(g).connect(master!); src.start(t); src.stop(t + 0.03);
}

let cachedNoise: { len: number; buf: AudioBuffer } | null = null;
function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.ceil(c.sampleRate * seconds);
  if (cachedNoise && cachedNoise.len >= len) return cachedNoise.buf;
  const buf = c.createBuffer(1, Math.max(len, c.sampleRate * 2), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  cachedNoise = { len: d.length, buf };
  return buf;
}
