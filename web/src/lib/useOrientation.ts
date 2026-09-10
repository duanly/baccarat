import { useEffect, useState } from 'react';
import { native } from './native';

export type Orientation = 'portrait' | 'landscape';

/**
 * 布局朝向：
 *  - 手机横屏（宽 > 高 且 高 < 560px）→ landscape 布局
 *  - 其余（竖屏手机、平板竖屏、桌面浏览器）→ portrait 布局（桌面本身够宽，portrait 布局里已是左右分栏）
 *  - 用户可手动锁定；在壳 App 内会同时旋转设备
 */
function detect(): Orientation {
  return window.innerWidth > window.innerHeight && window.innerHeight < 560 ? 'landscape' : 'portrait';
}

export function useOrientation() {
  const [auto, setAuto] = useState<Orientation>(detect);
  const [forced, setForced] = useState<Orientation | null>(null);

  useEffect(() => {
    const on = () => setAuto(detect());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);

  const orientation = forced ?? auto;

  const set = (o: Orientation | 'auto') => {
    if (o === 'auto') { setForced(null); native.setOrientation('auto'); return; }
    native.setOrientation(o);       // App 内：真的旋转设备，随后 resize 事件会更新 auto
    setForced(native.isApp ? null : o); // 浏览器里：只能强制切换布局
  };

  return { orientation, set, isForced: forced !== null };
}

/** 宽屏（桌面 / 平板横放）：宽 >= 900px */
export function useWide(): boolean {
  const [w, setW] = useState(() => window.innerWidth >= 900);
  useEffect(() => {
    const on = () => setW(window.innerWidth >= 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}
