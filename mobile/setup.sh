#!/usr/bin/env bash
# 一次性初始化：生成 android/ ios/ 平台工程并打上需要的配置补丁。
#   ./setup.sh [org] [appName]      例：./setup.sh com.yourco.baccarat 百家乐
set -euo pipefail
cd "$(dirname "$0")"
ORG=${1:-com.example.baccarat}
APP_NAME=${2:-Baccarat}

command -v flutter >/dev/null || { echo "请先安装 Flutter SDK: https://docs.flutter.dev/get-started/install"; exit 1; }

# 在当前目录补齐平台工程（不会覆盖已有的 lib/ pubspec.yaml）
flutter create . --org "$ORG" --project-name baccarat_app --platforms ios,android
flutter pub get

python3 - "$APP_NAME" <<'PY'
import re, sys, pathlib
app_name = sys.argv[1]

# ---------- Android ----------
m = pathlib.Path('android/app/src/main/AndroidManifest.xml')
s = m.read_text()
if 'android.permission.INTERNET' not in s:
    s = s.replace('<application', '<uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>\n    <uses-permission android:name="android.permission.VIBRATE"/>\n    <application', 1)
if 'usesCleartextTraffic' not in s:   # 开发期允许 http（生产全 https 后可删）
    s = s.replace('<application', '<application\n        android:usesCleartextTraffic="true"', 1)
s = re.sub(r'android:label="[^"]*"', f'android:label="{app_name}"', s, count=1)
m.write_text(s)

g = pathlib.Path('android/app/build.gradle.kts')
if not g.exists(): g = pathlib.Path('android/app/build.gradle')
s = g.read_text()
s = re.sub(r'minSdk\s*=?\s*flutter\.minSdkVersion', 'minSdk = 21', s)
s = re.sub(r'minSdkVersion\s+flutter\.minSdkVersion', 'minSdkVersion 21', s)
g.write_text(s)

# ---------- iOS ----------
p = pathlib.Path('ios/Runner/Info.plist')
s = p.read_text()
add = ''
if 'NSAppTransportSecurity' not in s:
    add += '''
	<key>NSAppTransportSecurity</key>
	<dict><key>NSAllowsArbitraryLoads</key><true/></dict>'''
if 'NSCameraUsageDescription' not in s:
    add += '''
	<key>NSCameraUsageDescription</key><string>用于视频客服</string>
	<key>NSMicrophoneUsageDescription</key><string>用于语音客服</string>'''
if 'UIViewControllerBasedStatusBarAppearance' not in s:
    add += '''
	<key>UIViewControllerBasedStatusBarAppearance</key><false/>
	<key>UIStatusBarHidden</key><true/>'''
s = s.replace('</dict>\n</plist>', add + '\n</dict>\n</plist>')
s = re.sub(r'(<key>CFBundleDisplayName</key>\s*<string>)[^<]*', r'\g<1>' + app_name, s)
p.write_text(s)
print('patched AndroidManifest.xml / build.gradle / Info.plist')
PY

echo
echo "完成。接下来："
echo "  调试：flutter run --dart-define=H5_URL=http://<你的电脑局域网IP>:5173"
echo "  安卓包：flutter build apk --release --dart-define=H5_URL=https://game.yourdomain.com"
echo "  iOS 包：flutter build ipa --release --export-method enterprise --dart-define=H5_URL=https://game.yourdomain.com"
