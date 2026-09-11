/**
 * 原生壳桥接（mobile/ Flutter 壳）。
 * 运行在壳内（Flutter InAppWebView 或 ios/ 原生 WKWebView）时桥可用；在普通浏览器里所有方法退化为 no-op / localStorage。
 */
declare global {
  interface Window {
    flutter_inappwebview?: { callHandler: (name: string, ...args: unknown[]) => Promise<any> };
    /** 原生 iOS 壳（ios/ 目录，WKWebView）注入的桥 */
    __nativeBridge?: { call: (name: string, ...args: unknown[]) => Promise<any> };
  }
}

export interface DeviceInfo {
  platform: string; model: string; osVersion: string; deviceId: string; appVersion: string; build: string;
}

/** 两种壳统一成一个调用入口：Flutter(InAppWebView) 或 原生 WKWebView */
const hasBridge = () => !!(window.flutter_inappwebview || window.__nativeBridge);
const call = (name: string, ...args: unknown[]): Promise<any> =>
  window.flutter_inappwebview ? window.flutter_inappwebview.callHandler(name, ...args) : window.__nativeBridge!.call(name, ...args);

export const native = {
  get isApp(): boolean {
    return hasBridge() || /BaccaratApp\//.test(navigator.userAgent);
  },
  get platform(): 'ios' | 'android' | 'web' {
    if (!native.isApp) return 'web';
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
  },
  async getToken(): Promise<string | null> {
    if (hasBridge()) return (await call('getToken')) ?? null;
    try { return localStorage.getItem('baccarat.token'); } catch { return null; }
  },
  async setToken(token: string | null): Promise<void> {
    if (hasBridge()) { await call('setToken', token ?? ''); return; }
    try { token ? localStorage.setItem('baccarat.token', token) : localStorage.removeItem('baccarat.token'); } catch { /* ignore */ }
  },
  async getDeviceInfo(): Promise<DeviceInfo | null> {
    return hasBridge() ? call('getDeviceInfo') : null;
  },
  vibrate() {
    if (hasBridge()) void call('vibrate');
    else navigator.vibrate?.(30);
  },
  openExternal(url: string) {
    if (hasBridge()) void call('openExternal', url);
    else window.open(url, '_blank');
  },
  setClipboard(text: string) {
    if (hasBridge()) void call('setClipboard', text);
  },
  setOrientation(o: 'portrait' | 'landscape' | 'auto') {
    if (hasBridge()) void call('setOrientation', o);
  },
  /** 壳在前后台切换时派发 native:lifecycle 事件（resumed / paused / inactive / hidden / detached） */
  onLifecycle(cb: (state: string) => void) {
    const h = (e: Event) => cb((e as CustomEvent).detail);
    window.addEventListener('native:lifecycle', h);
    return () => window.removeEventListener('native:lifecycle', h);
  },
};
