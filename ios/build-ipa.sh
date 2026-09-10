#!/usr/bin/env bash
# 一键打包 ipa：./build-ipa.sh https://game.yourdomain.com [enterprise|app-store|ad-hoc]
set -euo pipefail
cd "$(dirname "$0")"
H5_URL=${1:-https://baccarat.yytbank.cn}
METHOD=${2:-enterprise}
EXPORT_PLIST="ExportOptions-${METHOD}.plist"
[ -f "$EXPORT_PLIST" ] || { sed "s#<string>enterprise</string>#<string>${METHOD}</string>#" ExportOptions-enterprise.plist > "$EXPORT_PLIST"; }

command -v xcodegen >/dev/null || { echo "需要 XcodeGen：brew install xcodegen"; exit 1; }
xcodegen generate

rm -rf build
xcodebuild -project Baccarat.xcodeproj -scheme Baccarat -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Baccarat.xcarchive \
  H5_URL="$H5_URL" archive | xcpretty 2>/dev/null || true
[ -d build/Baccarat.xcarchive ] || { echo "archive 失败，用 Xcode 打开 Baccarat.xcodeproj 看签名配置"; exit 1; }

xcodebuild -exportArchive -archivePath build/Baccarat.xcarchive \
  -exportOptionsPlist "$EXPORT_PLIST" -exportPath build/ipa
echo
echo "✅ ipa: $(ls build/ipa/*.ipa)"
ls build/ipa/*.plist 2>/dev/null && echo "   manifest.plist 已生成，可用于 itms-services 网页安装"
