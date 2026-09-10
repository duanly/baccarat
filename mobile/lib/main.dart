import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // 沉浸式：隐藏状态栏/导航栏，H5 用 safe-area 变量自行留边
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  if (Platform.isAndroid) {
    await InAppWebViewController.setWebContentsDebuggingEnabled(true); // chrome://inspect 调试 H5
  }
  runApp(const BaccaratApp());
}

class BaccaratApp extends StatelessWidget {
  const BaccaratApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(brightness: Brightness.dark, scaffoldBackgroundColor: const Color(0xFF0E1A14)),
      home: const GameShell(),
    );
  }
}

class GameShell extends StatefulWidget {
  const GameShell({super.key});

  @override
  State<GameShell> createState() => _GameShellState();
}

class _GameShellState extends State<GameShell> with WidgetsBindingObserver {
  InAppWebViewController? _web;
  final _storage = const FlutterSecureStorage();
  double _progress = 0;
  bool _failed = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WakelockPlus.enable();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    WakelockPlus.disable();
    super.dispose();
  }

  /// 前后台切换通知 H5（切回前台时 H5 重连 WebSocket / 刷新余额）
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _web?.evaluateJavascript(source: "window.dispatchEvent(new CustomEvent('native:lifecycle',{detail:'${state.name}'}))");
  }

  /// 注册 JS 桥：H5 侧 window.flutter_inappwebview.callHandler('name', args)
  void _registerBridge(InAppWebViewController c) {
    c.addJavaScriptHandler(handlerName: 'getToken', callback: (_) => _storage.read(key: 'token'));
    c.addJavaScriptHandler(handlerName: 'setToken', callback: (args) async {
      final v = args.isNotEmpty ? args[0] as String? : null;
      if (v == null || v.isEmpty) {
        await _storage.delete(key: 'token');
      } else {
        await _storage.write(key: 'token', value: v);
      }
      return true;
    });
    c.addJavaScriptHandler(handlerName: 'getDeviceInfo', callback: (_) async {
      final pkg = await PackageInfo.fromPlatform();
      final info = DeviceInfoPlugin();
      String model = '', osVersion = '', deviceId = '';
      if (Platform.isAndroid) {
        final a = await info.androidInfo;
        model = '${a.manufacturer} ${a.model}';
        osVersion = 'Android ${a.version.release}';
        deviceId = a.id;
      } else if (Platform.isIOS) {
        final i = await info.iosInfo;
        model = i.utsname.machine;
        osVersion = '${i.systemName} ${i.systemVersion}';
        deviceId = i.identifierForVendor ?? '';
      }
      return {
        'platform': Platform.operatingSystem,
        'model': model,
        'osVersion': osVersion,
        'deviceId': deviceId,
        'appVersion': pkg.version,
        'build': pkg.buildNumber,
      };
    });
    c.addJavaScriptHandler(handlerName: 'vibrate', callback: (_) => HapticFeedback.mediumImpact());
    c.addJavaScriptHandler(handlerName: 'openExternal', callback: (args) async {
      final url = Uri.tryParse(args.isNotEmpty ? args[0] as String : '');
      if (url != null) await launchUrl(url, mode: LaunchMode.externalApplication);
    });
    c.addJavaScriptHandler(handlerName: 'setOrientation', callback: (args) async {
      final mode = args.isNotEmpty ? args[0] as String : 'portrait';
      await SystemChrome.setPreferredOrientations(switch (mode) {
        'landscape' => [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight],
        'auto' => [DeviceOrientation.portraitUp, DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight],
        _ => [DeviceOrientation.portraitUp],
      });
    });
    c.addJavaScriptHandler(handlerName: 'setClipboard', callback: (args) async {
      await Clipboard.setData(ClipboardData(text: args.isNotEmpty ? args[0] as String : ''));
    });
  }

  Future<void> _reload() async {
    setState(() { _failed = false; _progress = 0; });
    await _web?.loadUrl(urlRequest: URLRequest(url: WebUri(AppConfig.h5Url)));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        // Android 返回键：先走 H5 历史，再退出
        if (didPop) return;
        if (_web != null && await _web!.canGoBack()) {
          _web!.goBack();
        } else {
          SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0E1A14),
        body: Stack(
          children: [
            InAppWebView(
              initialUrlRequest: URLRequest(url: WebUri(AppConfig.h5Url)),
              initialSettings: InAppWebViewSettings(
                javaScriptEnabled: true,
                useShouldOverrideUrlLoading: true,
                domStorageEnabled: true,
                databaseEnabled: true,
                mediaPlaybackRequiresUserGesture: false, // 荷官视频自动播放
                allowsInlineMediaPlayback: true,          // iOS 内联播放（不弹全屏播放器）
                allowsPictureInPictureMediaPlayback: false,
                applicationNameForUserAgent: AppConfig.uaSuffix,
                transparentBackground: true,
                useHybridComposition: true,
                supportZoom: false,
                disableVerticalScroll: false,
                allowsBackForwardNavigationGestures: false,
                // iOS 14.3+ WKWebView 支持 WebRTC；Android WebView 原生支持
                iframeAllow: 'camera; microphone; autoplay',
                iframeAllowFullscreen: true,
                mixedContentMode: MixedContentMode.MIXED_CONTENT_ALWAYS_ALLOW, // 开发期 http 媒体服务器；生产全 https 后可去掉
              ),
              onWebViewCreated: (c) {
                _web = c;
                _registerBridge(c);
              },
              onProgressChanged: (_, p) => setState(() => _progress = p / 100),
              onReceivedError: (_, req, err) {
                if (req.isForMainFrame ?? true) setState(() { _failed = true; _error = err.description; });
              },
              onReceivedHttpError: (_, req, resp) {
                if ((req.isForMainFrame ?? true) && (resp.statusCode ?? 0) >= 500) {
                  setState(() { _failed = true; _error = 'HTTP ${resp.statusCode}'; });
                }
              },
              // WebRTC 拉流：WHEP 是 recvonly，不需要摄像头麦克风，但 Android WebView 仍会请求 RESOURCE_PROTECTED_MEDIA_ID 等
              onPermissionRequest: (_, req) async =>
                  PermissionResponse(resources: req.resources, action: PermissionResponseAction.GRANT),
              // 拦截外链：非 H5 域名用系统浏览器打开
              shouldOverrideUrlLoading: (_, nav) async {
                final url = nav.request.url;
                if (url == null) return NavigationActionPolicy.ALLOW;
                final h5 = Uri.parse(AppConfig.h5Url);
                if (url.host == h5.host || url.scheme == 'about') return NavigationActionPolicy.ALLOW;
                await launchUrl(url, mode: LaunchMode.externalApplication);
                return NavigationActionPolicy.CANCEL;
              },
            ),
            if (_progress < 1 && !_failed)
              const Center(child: CircularProgressIndicator(color: Color(0xFFD4AF37))),
            if (_failed)
              Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('无法连接到游戏服务器', style: TextStyle(fontSize: 18, color: Colors.white)),
                    const SizedBox(height: 8),
                    Text(_error, style: const TextStyle(color: Colors.white54, fontSize: 12)),
                    const SizedBox(height: 16),
                    FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: const Color(0xFFD4AF37), foregroundColor: Colors.black),
                      onPressed: _reload,
                      child: const Text('重试'),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
