# iOS 原生壳（Swift + WKWebView，Xcode 工程）

不依赖 Flutter 的纯原生壳：一个 `WKWebView` 全屏加载远程 H5（`../web`），JS 桥与 Flutter 壳完全一致
（`getToken / setToken / getDeviceInfo / vibrate / openExternal / setOrientation / setClipboard`，前后台 `native:lifecycle` 事件），
web 端代码不用改。

## 生成 Xcode 工程

工程文件由 [XcodeGen](https://github.com/yonaskolb/XcodeGen) 从 `project.yml` 生成（`.xcodeproj` 不进 git，避免合并冲突）：

```bash
brew install xcodegen
cd ios
xcodegen generate          # 生成 Baccarat.xcodeproj
open Baccarat.xcodeproj    # 在 Xcode 里选 Team、真机运行
```

先改 `project.yml` 里的 `bundleIdPrefix` / `PRODUCT_BUNDLE_IDENTIFIER` / `DEVELOPMENT_TEAM`，
`H5_URL` 是 H5 地址（真机调试填电脑局域网 IP，如 `http://192.168.1.100:5173`）。

## 打包 ipa

**方式一：脚本一键打包**（archive + export）

```bash
# 企业签直装（默认）
./build-ipa.sh https://game.yourdomain.com enterprise
# TestFlight / App Store
./build-ipa.sh https://game.yourdomain.com app-store
# Ad Hoc（指定设备 UDID）
./build-ipa.sh https://game.yourdomain.com ad-hoc
```

产物在 `ios/build/ipa/Baccarat.ipa`；企业签会同时生成 `manifest.plist`，放到 https 站点后用
`itms-services://?action=download-manifest&url=https://dl.yourdomain.com/manifest.plist` 做网页安装。
`ExportOptions-enterprise.plist` 里填好 `teamID` 和下载地址。

**方式二：Xcode 图形界面**：Product → Archive → Distribute App → 选 Enterprise / App Store Connect / Ad Hoc → Export。

## 说明

- 最低 iOS 14；WebRTC(WHEP) 拉流需 iOS 14.3+。
- `Info.plist` 里 `NSAllowsArbitraryLoads` 是开发期放行 http 用的，生产改成 https 后删掉。
- 图标在 `Baccarat/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`（1024×1024 单图，Xcode 15 自动生成各尺寸），换成你的即可。
- 横竖屏：默认锁竖屏，H5 进入牌桌时调 `setOrientation('auto')` 放开，离开时锁回。
- 与 `mobile/`（Flutter 壳）二选一即可；Android 继续用 Flutter 壳，或者后续同样出一个原生 Android WebView 壳。
