import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { openDb } from './db/index.js';
import { AuthService } from './auth.js';
import { Wallet } from './wallet.js';
import { TableManager, SqlitePersistence, seedDefaultLayout } from './game/manager.js';
import { apiRouter, errorHandler } from './http/routes.js';
import { attachWs } from './ws/server.js';
import { BotService } from './bots.js';
import { adminRouter } from './http/admin.js';
import { Presence } from './presence.js';
import { RoomService } from './rooms.js';

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = process.env.DB_PATH ?? join(dirname(fileURLToPath(import.meta.url)), '../../data/baccarat.db');
const MEDIA_BASE = process.env.MEDIA_BASE ?? 'http://localhost:1985'; // SRS HTTP API（WHIP/WHEP）
const config = {
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  tokenTtlSec: 7 * 24 * 3600,
  signupBonus: Number(process.env.SIGNUP_BONUS ?? 10000),
};
const DEALER_API_KEY = process.env.DEALER_API_KEY ?? 'dealer-dev-key';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'admin123';

const db = openDb(DB_PATH);
const auth = new AuthService(db, config);
const wallet = new Wallet(db);
const presence = new Presence(db);
auth.ensureAdmin(ADMIN_USER, ADMIN_PASS);
const tables = new TableManager(wallet, new SqlitePersistence(db));
seedDefaultLayout(tables, { mediaBase: MEDIA_BASE, rngTables: Number(process.env.RNG_TABLES ?? 12), vipHalls: Number(process.env.VIP_HALLS ?? 3) });
// 后台保存过的每桌参数（下注时长 / 发牌间隔 / 派彩停顿 / 限红）
try {
  for (const row of db.prepare('SELECT * FROM table_settings').all() as any[]) {
    tables.tables.get(row.table_id)?.updateSettings({
      bettingSeconds: row.betting_seconds ?? undefined, dealIntervalMs: row.deal_interval_ms ?? undefined, resultPauseSeconds: row.result_pause_seconds ?? undefined,
      minBet: row.min_bet ?? undefined, maxBet: row.max_bet ?? undefined, maxSideBet: row.max_side_bet ?? undefined,
    });
  }
} catch (e: any) {
  console.warn('[table_settings] 读取失败（跳过，使用默认参数）:', e.message);
}

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dealer-Key, X-Device');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/health', (_req, res) => res.json({ ok: true, tables: tables.tables.size }));
const rooms = new RoomService(db, wallet, tables);
const bots = new BotService(db, wallet, tables);
app.use('/api/admin', adminRouter({ db, auth, wallet, presence, tables, rooms, bots }));
app.use('/api', apiRouter({ auth, wallet, tables, db, dealerApiKey: DEALER_API_KEY, rooms }));

// 生产：托管前端构建产物
const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}
app.use(errorHandler);

const server = createServer(app);
attachWs(server, auth, tables, presence, rooms, wallet);
tables.startAll();
rooms.restore();   // 恢复活跃的私人房间（各自独立的 RNG 牌桌）

if (bots.config.enabled) bots.start();
server.listen(PORT, () => {
  console.log(`baccarat server on http://localhost:${PORT}  (db: ${DB_PATH})`);
  console.log(`halls: ${tables.halls.map((h) => `${h.name}[${h.tableIds.length}]`).join(', ')}`);
  console.log(`admin: ${ADMIN_USER} (后台 /admin)`);
});

process.on('SIGINT', () => { tables.stopAll(); server.close(); process.exit(0); });
