# Baccarat 百家乐平台

大厅（RNG 自动派牌）+ VIP 厅（真人荷官实况视频）的百家乐游戏骨架。Node.js + TypeScript 服务端，React 前端，零外部服务即可本地跑通。

## 快速开始

```bash
npm install                # 安装 server + web 两个 workspace
npm run dev                # 后端 :8080 + 前端 :5173（Vite 代理 /api 与 /ws）
# 另开一个终端：让 VIP 桌"动起来"（模拟荷官 / RFID 识牌事件）
npm --workspace=server exec tsx src/tools/dealer-sim.ts
```

打开 http://localhost:5173 ，注册账号（演示环境赠送 10000 测试筹码）即可进入大厅。
VIP 厅需要 `users.vip_level >= 厅等级`，演示时直接改库：

```bash
sqlite3 server/data/baccarat.db "update users set vip_level=3 where username='你的用户名'"
```

生产构建：`npm run build && npm start`（服务端直接托管 `web/dist`）。

管理后台：用 `ADMIN_USER` / `ADMIN_PASS`（默认 `admin` / `admin123`，生产必改）登录后，大厅右上角"管理后台"或直接打开 `/admin`。
支持玩家搜索、组别、在线过滤、上下分（带操作员与备注）、冻结、VIP 等级，以及每个玩家的流水/输赢/上下分/下注频率/在线时长统计和日志。

## 目录

```
server/src
  auth.ts             注册/登录（scrypt 密码 + HS256 JWT）
  wallet.ts           余额与流水
  db/index.ts         SQLite 表结构（users / transactions / shoes / rounds / bets）
  game/rng.ts         CSPRNG 牌靴：8 副牌、Fisher–Yates、切牌、烧牌、牌序指纹
  game/rules.ts       补牌规则状态机（RNG 桌自动抽牌 / 实况桌逐张喂牌共用）
  game/payouts.ts     赔付表：庄/闲/和/闲对/庄对/任意对/完美对/幸运6/幸运7/大/小，免佣模式
  game/roadmap.ts     珠盘路、大路、大眼仔、小路、曱甴路、问路
  game/table.ts       单桌状态机：投注→发牌→结算→停顿；押注/输赢排行榜
  game/manager.ts     大厅 / VIP 厅布局（默认 12 张 RNG 桌 + 3 个 VIP 厅 × 5 桌）
  http/routes.ts      REST：账号、大厅、下注、历史；/api/dealer/* 荷官与 ETG 设备接口
  http/admin.ts       玩家管理后台 API：组别、上下分、统计、日志、在线/IP/设备
  presence.ts         在线状态与登录会话（IP、设备、在线时长）
  ws/server.ts        WebSocket：牌桌状态、逐张发牌、开奖、排行榜、个人结算推送
  tools/dealer-sim.ts 荷官端模拟器
web/src
  pages/AuthPage      登录 / 注册
  pages/LobbyPage     大厅与 VIP 厅列表（每桌缩略大路、阶段、倒计时、在线人数）
  pages/TablePage     牌桌：视频/牌面、投注区、筹码、玩家押注面板、完整牌路
  pages/AdminPage     玩家管理后台（/admin，仅 admin 角色）
  components/Roadmap  路单 SVG 渲染（6 行折行、龙尾、和局斜线、对子标记）
  components/LiveVideo WebRTC WHEP 播放器
  components/DealerScene 牌盒 + 飞牌动画（RNG 桌）
  lib/fly.ts           通用飞行动画（筹码飞入投注区 / 飞回筹码栏 / 他人筹码飞入）
  components/SqueezeCard 咪牌：拖动牌角/牌边掀开（VIP 桌）
  components/ChipStack 筹码堆叠
deploy/               SRS 媒体服务器 docker-compose（WHIP 推流 / WHEP 拉流 / HLS 兜底）
mobile/               iOS/Android 壳 App（Flutter + InAppWebView 加载 H5，JS 桥），见 mobile/README.md
ios/                  iOS 原生壳（Swift + WKWebView，XcodeGen 生成 Xcode 工程，一键打 ipa），见 ios/README.md
```

## 两类牌桌的驱动方式

| | 大厅 RNG 桌 | VIP 实况桌 |
|---|---|---|
| 开局 | 服务端定时器自动循环 | 荷官端 `POST /api/dealer/tables/:id/open` |
| 派牌 | `Shoe.draw()`（CSPRNG） | RFID / 摄像头识别 → `POST /api/dealer/tables/:id/card {card:"HK"}` |
| 补牌判定 | `Hand.nextTarget()` | 同上，接口返回该牌落点与是否还需补牌 |
| 结算 / 牌路 / 排行榜 | 共用 `BaccaratTable` | 共用 |
| 视频 | 无 | WHEP 地址在 `TableConfig.stream`，前端自动拉流 |

荷官接口鉴权：请求头 `X-Dealer-Key`（环境变量 `DEALER_API_KEY`）或 role 为 dealer/admin 的 JWT。
其他荷官操作：`/close` 提前封盘、`/shuffle` 换靴、`/void` 作废本局并退注。

## 生产部署（https://baccarat.yytbank.cn）

服务器装好 Docker，域名解析到服务器，开放 80/443（HTTPS）、1935（荷官推流）、8000/udp（WebRTC）：

```bash
git clone <仓库> baccarat && cd baccarat
cp deploy/.env.example deploy/.env && vi deploy/.env     # JWT_SECRET / DEALER_API_KEY / ADMIN_PASS / PUBLIC_IP
./deploy/deploy.sh                                       # 构建镜像并启动 caddy + baccarat + srs
```

Caddy 自动申请证书；`/api`、`/ws`、H5 静态由游戏服务端提供，`/rtc/*`（WHEP/WHIP）与 `/live/*`（HLS）转给 SRS，
全部走同一个域名的 HTTPS，App 壳里不再需要任何 http 放行。以后更新：`git pull && ./deploy/deploy.sh`。
数据库在 docker volume `baccarat_data`（备份：`docker compose ... cp baccarat:/data/baccarat.db ./backup.db`）。

同一台服务器部署第二个 App 的服务端：在 `deploy/docker-compose.prod.yml` 里加一个 service，`deploy/Caddyfile` 里加一个站点块
（另一个子域名，或同域名不同路径）指向它，`./deploy/deploy.sh` 重启即可，两个服务互不影响。

## 实况视频链路

荷官摄像头 → OBS（WHIP）或 ffmpeg → SRS（`deploy/`）→ 浏览器 WebRTC（WHEP），延迟通常 < 1 秒，投注倒计时与画面同步。

```bash
CANDIDATE=<本机局域网IP> docker compose -f deploy/docker-compose.yml up -d
# 推流测试（ffmpeg 生成测试画面到 vip1-t1）
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=25 -f lavfi -i sine \
  -c:v libx264 -profile:v baseline -tune zerolatency -c:a libopus \
  -f whip http://localhost:1985/rtc/v1/whip/?app=live&stream=vip1-t1
```

服务端通过 `MEDIA_BASE` 环境变量指向媒体服务器（默认 `http://localhost:1985`）。

## 押注面板排序

`BaccaratTable.leaderboard()`：按本桌累计押注流水降序，流水相同再按输赢绝对值降序；每行含本局各区注码、累计流水、累计输赢、上一局输赢。

## RNG 合规

`game/rng.ts` 使用操作系统 CSPRNG + 无偏 Fisher–Yates，每靴记录洗牌后牌序的 SHA-256 指纹与全部发牌顺序（`shoes` / `rounds` 表）以供审计。正式上线前需交由 GLI / iTech Labs / BMM 等实验室做 RNG 认证（统计测试、源码审查、构建签名），仓库内 `test/rules.test.ts` 仅做基础分布自检。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8080 | 服务端口 |
| `DB_PATH` | server/data/baccarat.db | SQLite 路径 |
| `JWT_SECRET` | dev-secret-change-me | 生产必改 |
| `DEALER_API_KEY` | dealer-dev-key | 荷官/设备接口密钥 |
| `SIGNUP_BONUS` | 10000 | 注册赠送筹码（生产设 0） |
| `ADMIN_USER` / `ADMIN_PASS` | admin / admin123 | 管理员账号（启动时自动创建） |
| `MEDIA_BASE` | http://localhost:1985 | SRS HTTP API 地址 |
| `RNG_TABLES` / `VIP_HALLS` | 12 / 3 | 大厅桌数 / VIP 厅数（每厅 5 桌） |

## 下一步（骨架未覆盖）

- 支付/充值、KYC、风控限额、同 IP 对冲检测
- PostgreSQL + Redis 替换 SQLite；多实例时牌桌进程独立部署（每桌一个 actor）
- 后台管理：桌台配置、荷官排班、注单查询、报表
- 视频：TURN 服务器、CDN、HLS 兜底自动切换、多机位
- 幸运 7 的具体定义按你的产品规则调整（`payouts.ts` 顶部说明）
