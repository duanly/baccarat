import UIKit
import WebKit
import AVFoundation

/// 原生壳：全屏 WKWebView 加载远程 H5 + JS 桥。
/// H5 侧协议（web/src/lib/native.ts）：
///   window.webkit.messageHandlers.native.postMessage({ id, method, args })
///   壳回调：window.__nativeCallback(id, result)
final class GameViewController: UIViewController {
    private var webView: WKWebView!
    private let errorView = UIView()
    private let errorLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)

    private var h5URL: URL {
        let s = (Bundle.main.object(forInfoDictionaryKey: "H5URL") as? String) ?? ""
        return URL(string: s.isEmpty ? "https://baccarat.yytbank.cn" : s)!
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { AppDelegate.orientationMask }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.055, green: 0.10, blue: 0.078, alpha: 1)
        // 音效：WKWebView 里的 Web Audio 默认跟随静音键；设为 playback 后静音键不再静音游戏音效（与其他游戏 App 一致）
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true                 // 荷官视频内联播放
        config.mediaTypesRequiringUserActionForPlayback = []    // 自动播放
        config.applicationNameForUserAgent = "BaccaratApp/1.0"  // H5 用它识别壳
        config.userContentController.add(self, name: "native")
        // 桥的 JS 端：在页面脚本之前注入
        let bridgeJS = """
        (function(){
          if (window.__nativeBridge) return;
          var seq = 0, pending = {};
          window.__nativeBridge = {
            call: function(method){
              var args = Array.prototype.slice.call(arguments, 1);
              return new Promise(function(resolve, reject){
                var id = ++seq; pending[id] = {resolve: resolve, reject: reject};
                window.webkit.messageHandlers.native.postMessage({id: id, method: method, args: args});
              });
            }
          };
          window.__nativeCallback = function(id, result, error){
            var p = pending[id]; if (!p) return; delete pending[id];
            error ? p.reject(new Error(error)) : p.resolve(result);
          };
        })();
        """
        config.userContentController.addUserScript(WKUserScript(source: bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        if #available(iOS 16.4, *) { webView.isInspectable = true }   // Safari 调试
        view.addSubview(webView)

        setupErrorView()
        spinner.color = UIColor(red: 0.83, green: 0.69, blue: 0.22, alpha: 1)
        spinner.center = view.center
        spinner.autoresizingMask = [.flexibleTopMargin, .flexibleBottomMargin, .flexibleLeftMargin, .flexibleRightMargin]
        view.addSubview(spinner)

        NotificationCenter.default.addObserver(self, selector: #selector(appActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appInactive), name: UIApplication.willResignActiveNotification, object: nil)
        load()
    }

    private func load() {
        errorView.isHidden = true
        spinner.startAnimating()
        var req = URLRequest(url: h5URL)
        req.cachePolicy = .reloadRevalidatingCacheData
        webView.load(req)
    }

    private func setupErrorView() {
        errorView.frame = view.bounds
        errorView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        errorView.backgroundColor = view.backgroundColor
        errorView.isHidden = true
        let stack = UIStackView()
        stack.axis = .vertical; stack.spacing = 12; stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        let title = UILabel(); title.text = "无法连接到游戏服务器"; title.textColor = .white; title.font = .systemFont(ofSize: 18, weight: .semibold)
        errorLabel.textColor = .lightGray; errorLabel.font = .systemFont(ofSize: 12); errorLabel.numberOfLines = 0; errorLabel.textAlignment = .center
        let btn = UIButton(type: .system)
        btn.setTitle("重试", for: .normal)
        btn.setTitleColor(.black, for: .normal)
        btn.backgroundColor = UIColor(red: 0.83, green: 0.69, blue: 0.22, alpha: 1)
        btn.layer.cornerRadius = 8
        btn.contentEdgeInsets = UIEdgeInsets(top: 8, left: 28, bottom: 8, right: 28)
        btn.addTarget(self, action: #selector(retry), for: .touchUpInside)
        [title, errorLabel, btn].forEach(stack.addArrangedSubview)
        errorView.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: errorView.centerXAnchor), stack.centerYAnchor.constraint(equalTo: errorView.centerYAnchor)])
        view.addSubview(errorView)
    }

    @objc private func retry() { load() }
    @objc private func appActive() { dispatchLifecycle("resumed") }
    @objc private func appInactive() { dispatchLifecycle("paused") }

    private func dispatchLifecycle(_ state: String) {
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('native:lifecycle',{detail:'\(state)'}))")
    }

    // MARK: - 桥方法

    private func handle(_ method: String, _ args: [Any], reply: @escaping (Any?, String?) -> Void) {
        switch method {
        case "getToken":
            reply(Keychain.read("token"), nil)
        case "setToken":
            let v = args.first as? String ?? ""
            v.isEmpty ? Keychain.delete("token") : Keychain.write("token", v)
            reply(true, nil)
        case "getDeviceInfo":
            let d = UIDevice.current
            reply([
                "platform": "ios",
                "model": Self.machineModel(),
                "osVersion": "\(d.systemName) \(d.systemVersion)",
                "deviceId": d.identifierForVendor?.uuidString ?? "",
                "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            ], nil)
        case "vibrate":
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            reply(nil, nil)
        case "openExternal":
            if let s = args.first as? String, let url = URL(string: s) { UIApplication.shared.open(url) }
            reply(nil, nil)
        case "setOrientation":
            let mode = args.first as? String ?? "portrait"
            switch mode {
            case "landscape": AppDelegate.orientationMask = .landscape
            case "auto": AppDelegate.orientationMask = [.portrait, .landscape]
            default: AppDelegate.orientationMask = .portrait
            }
            if #available(iOS 16.0, *) {
                setNeedsUpdateOfSupportedInterfaceOrientations()
                view.window?.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: AppDelegate.orientationMask))
            } else {
                let o: UIInterfaceOrientation = mode == "landscape" ? .landscapeRight : .portrait
                if mode != "auto" { UIDevice.current.setValue(o.rawValue, forKey: "orientation") }
                UIViewController.attemptRotationToDeviceOrientation()
            }
            reply(nil, nil)
        case "setClipboard":
            UIPasteboard.general.string = args.first as? String ?? ""
            reply(nil, nil)
        default:
            reply(nil, "unknown method \(method)")
        }
    }

    private static func machineModel() -> String {
        var sys = utsname(); uname(&sys)
        return withUnsafePointer(to: &sys.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
    }
}

// MARK: - JS → Native

extension GameViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let id = body["id"] as? Int, let method = body["method"] as? String else { return }
        let args = body["args"] as? [Any] ?? []
        handle(method, args) { [weak self] result, error in
            var json = "null"
            if let r = result, let data = try? JSONSerialization.data(withJSONObject: r, options: [.fragmentsAllowed]), let s = String(data: data, encoding: .utf8) { json = s }
            let err = error.map { "\"\($0)\"" } ?? "null"
            DispatchQueue.main.async { self?.webView.evaluateJavaScript("window.__nativeCallback(\(id), \(json), \(err))") }
        }
    }
}

// MARK: - 导航 / 权限 / 外链

extension GameViewController: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { spinner.stopAnimating(); errorView.isHidden = true }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(error) }
    private func showError(_ error: Error) {
        spinner.stopAnimating()
        errorLabel.text = error.localizedDescription
        errorView.isHidden = false
    }

    /// 非 H5 域名的链接交给系统浏览器
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, navigationAction.targetFrame?.isMainFrame ?? true else { return decisionHandler(.allow) }
        if url.host == h5URL.host || url.scheme == "about" || url.scheme == "blob" { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    /// WebRTC（WHEP 拉流是 recvonly，通常不会请求；若请求则放行）
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    /// target=_blank 的链接在当前 WebView 打开
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }
}

// MARK: - Keychain（token 持久化）

enum Keychain {
    private static let service = "com.yourco.baccarat"
    static func read(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key, kSecReturnData as String: true]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
    static func write(_ key: String, _ value: String) {
        delete(key)
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key,
                                kSecValueData as String: value.data(using: .utf8)!, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        SecItemAdd(q as CFDictionary, nil)
    }
    static func delete(_ key: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
    }
}
