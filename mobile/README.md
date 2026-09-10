# 移动端壳 App（Flutter + WebView）

与 Tesax 一类 App 相同的架构：**原生壳（Flutter）只负责启动、WebView、原生桥；游戏本体是远程 H5**（`../web`）。
游戏改版只需重新部署 web，玩家不用更新 App；只有壳本身改动（图标、启动图、桥、权限）才重新打包。

```
┌─────────────── iOS / Android App ───────────────┐
│ Flutter                                          │
│  └─ InAppWebView  ──加载──▶  https://game.xxx/   │  ← ../web（React）
│       ▲ JS 桥                                     │
│  getToken/setToken   → Keychain / Keystore        │
│  getDeviceInfo       → 设备型号、系统、deviceId    │
│  vibrate / openExternal / setOrientation / 剪贴板 │
│  native:lifecycle    → 前后台切换事件             │
└──────────────────────────────────────────────────┘
        WebSocket ─▶ server  /  WebRTC(WHEP) ─▶ SRS
```

## 初始化（只做一次）

```bash
cd mobile
./setup.sh com.yourco.baccarat 百家乐     # 生成 android/ ios/ 并打补丁（权限、http 放行、minSdk、状态栏）
```

## 真机调试

```bash
# 电脑上先起后端 + 前端（vite 已配置 host: true，局域网可访问）
cd .. && npm run dev

# 手机与电脑同一 Wi-Fi；把 IP 换成电脑的局域网地址
cd mobile
flutter run --dart-define=H5_URL=http://192.168.1.100:5173
```

Android 模拟器访问宿主机用 `http://10.0.2.2:5173`（这是 `config.dart` 的默认值）。
H5 调试：Android 打开 Chrome `chrome://inspect`；iOS 用 Safari → 开发 → 设备。

## 打包分发（不上商店）

**Android APK 直装**

```bash
# 先生成签名（一次）
keytool -genkey -v -keystore release.jks -alias baccarat -keyalg RSA -keysize 2048 -validity 10000
# android/key.properties 写入 storeFile/storePassword/keyAlias/keyPassword，并在 build.gradle 引用（Flutter 官方文档"Signing the app"）
flutter build apk --release --dart-define=H5_URL=https://game.yourdomain.com
# 产物：build/app/outputs/flutter-apk/app-release.apk
```

**iOS 企业签 / TestFlight**

```bash
# 企业开发者账号：Xcode 里选企业 Team + In-House 证书/描述文件
flutter build ipa --release --export-method enterprise --dart-define=H5_URL=https://game.yourdomain.com
# 产物：build/ios/ipa/*.ipa
```

OTA 安装页（放到 https 站点上，手机 Safari 打开）：

```html
<a href="itms-services://?action=download-manifest&url=https://dl.yourdomain.com/manifest.plist">安装 iOS 版</a>
```

`manifest.plist` 里填 ipa 的 https 地址、bundle-id、版本和名称（Xcode 导出 ipa 时勾选 "Include manifest for over-the-air installation" 会一并生成）。
TestFlight 分发则用 `--export-method app-store` 上传到 App Store Connect 后添加测试员。

生产环境请把 H5 与媒体服务器全部改成 **https / wss**，然后删除 `setup.sh` 打的两个放行补丁：Android 的 `usesCleartextTraffic` 与 iOS 的 `NSAllowsArbitraryLoads`，以及 `main.dart` 里的 `mixedContentMode`。

## 常见问题

- 视频黑屏：WebRTC 在 WKWebView 要求 iOS ≥ 14.3；SRS 的 `CANDIDATE` 必须是手机能访问到的 IP；公网环境需要 TURN。
- 切回前台断线：壳会派发 `native:lifecycle`，web 端 `App.tsx` 收到 `resumed` 后重连 WebSocket 并刷新余额。
- 横竖屏：壳默认锁竖屏；进入牌桌时 H5 调 `setOrientation('auto')` 允许自由旋转，牌桌右上角"横屏/竖屏"按钮可手动锁定；离开牌桌回到竖屏。布局判定在 `web/src/lib/useOrientation.ts`（宽 > 高且高 < 560px 为横屏布局）。
- 热更新：本方案 H5 本身就是远程的，天然"热更新"；若要离线包（首屏更快、弱网可用），可把 `web/dist` 打进 `assets/` 并用 InAppWebView 的本地服务器加载，再做版本号对比下载增量包。
