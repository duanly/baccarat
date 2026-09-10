/// 编译期配置：flutter build ... --dart-define=H5_URL=https://game.example.com
///
/// 与 Tesax 一类 App 的做法相同：原生壳只负责加载远程 H5，游戏内容更新只需重新部署 web，
/// 不用重新发版；只有壳本身（桥、权限、启动图）改动才需要重新打包。
class AppConfig {
  static const h5Url = String.fromEnvironment('H5_URL', defaultValue: 'https://baccarat.yytbank.cn');
  static const appName = String.fromEnvironment('APP_NAME', defaultValue: 'Baccarat');

  /// 自定义 UA 后缀，H5 端用它识别运行在壳内（window.native.isApp）
  static const uaSuffix = 'BaccaratApp/1.0';
}
