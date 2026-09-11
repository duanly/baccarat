/**
 * 存储层：Node 22 内置 node:sqlite（零依赖，方便本地跑通）。
 * 生产环境建议换成 PostgreSQL（表结构直接对应），Redis 存牌桌实时状态。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      nickname      TEXT NOT NULL,
      vip_level     INTEGER NOT NULL DEFAULT 0,
      balance       REAL NOT NULL DEFAULT 0,
      role          TEXT NOT NULL DEFAULT 'player',   -- player | dealer | admin
      created_at    INTEGER NOT NULL
    );

    -- 玩家组别（代理线 / 渠道 / 风控分组等）
    CREATE TABLE IF NOT EXISTS groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT UNIQUE NOT NULL,
      note       TEXT,
      created_at INTEGER NOT NULL
    );

    -- 登录会话：每次 WebSocket 连接一条，用于在线状态 / IP / 设备 / 在线时长
    CREATE TABLE IF NOT EXISTS sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      ip           TEXT,
      device       TEXT,               -- 设备型号 / 系统（App 桥上报或 UA 解析）
      user_agent   TEXT,
      started_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      ended_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, id);

    -- 钱包流水：每一笔余额变动
    CREATE TABLE IF NOT EXISTS transactions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      kind       TEXT NOT NULL,        -- deposit | bet | payout | refund | adjust
      amount     REAL NOT NULL,        -- 正为入账，负为出账
      balance    REAL NOT NULL,        -- 变动后余额
      ref        TEXT,                 -- round_id / 备注
      operator_id INTEGER,             -- 上下分操作员（管理员）
      note       TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);

    -- 牌靴：每靴记录随机源指纹，供审计
    CREATE TABLE IF NOT EXISTS shoes (
      id          TEXT PRIMARY KEY,
      table_id    TEXT NOT NULL,
      fingerprint TEXT,
      deck_count  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );

    -- 每一局：结果 + 全部牌序
    CREATE TABLE IF NOT EXISTS rounds (
      id            TEXT PRIMARY KEY,
      table_id      TEXT NOT NULL,
      shoe_id       TEXT NOT NULL,
      round_no      INTEGER NOT NULL,
      player_cards  TEXT NOT NULL,     -- JSON
      banker_cards  TEXT NOT NULL,
      outcome       TEXT NOT NULL,
      player_total  INTEGER NOT NULL,
      banker_total  INTEGER NOT NULL,
      player_pair   INTEGER NOT NULL,
      banker_pair   INTEGER NOT NULL,
      started_at    INTEGER NOT NULL,
      settled_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_rounds_table ON rounds(table_id, round_no);

    -- 注单
    CREATE TABLE IF NOT EXISTS bets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id   TEXT NOT NULL,
      table_id   TEXT NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      bet_type   TEXT NOT NULL,
      amount     REAL NOT NULL,
      returned   REAL,                 -- 结算后填入
      net        REAL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bets_round ON bets(round_id);
    CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, id);
    -- 后台可调的每桌参数（下注时长 / 发牌间隔 / 派彩停顿 / 限红）
    CREATE TABLE IF NOT EXISTS table_settings (
      table_id             TEXT PRIMARY KEY,
      betting_seconds      INTEGER,
      deal_interval_ms     INTEGER,
      result_pause_seconds INTEGER,
      min_bet              REAL,
      max_bet              REAL,
      max_side_bet         REAL,
      updated_at           INTEGER NOT NULL
    );
    -- 私人房间（VIP 创建，凭密码进入；房主可管理）
    CREATE TABLE IF NOT EXISTS rooms (
      id          TEXT PRIMARY KEY,            -- room-xxxxxx，同时也是牌桌 id
      name        TEXT NOT NULL,
      owner_id    INTEGER NOT NULL REFERENCES users(id),
      password    TEXT NOT NULL,               -- 4–8 位，活跃房间内唯一
      locked      INTEGER NOT NULL DEFAULT 0,  -- 上锁：非成员不能再进
      min_bet     REAL NOT NULL,
      max_bet     REAL NOT NULL,
      max_side_bet REAL NOT NULL,
      capacity    INTEGER NOT NULL DEFAULT 12,
      status      TEXT NOT NULL DEFAULT 'active',   -- active | closed
      created_at  INTEGER NOT NULL,
      closed_at   INTEGER
    );
    -- 私房积分：玩家在某个房主名下的积分（只能在该房主的房间使用；与大厅积分完全隔离）
    CREATE TABLE IF NOT EXISTS room_credits (
      user_id   INTEGER NOT NULL REFERENCES users(id),
      owner_id  INTEGER NOT NULL REFERENCES users(id),
      balance   REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, owner_id)
    );
    CREATE TABLE IF NOT EXISTS room_members (
      room_id    TEXT NOT NULL REFERENCES rooms(id),
      user_id    INTEGER NOT NULL REFERENCES users(id),
      joined_at  INTEGER NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );
  `);
  // 追加列（幂等）
  for (const sql of [
    "ALTER TABLE users ADD COLUMN group_id INTEGER REFERENCES groups(id)",
    "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",   // active | frozen
    "ALTER TABLE users ADD COLUMN last_login_at INTEGER",
    "ALTER TABLE users ADD COLUMN last_ip TEXT",
    "ALTER TABLE users ADD COLUMN last_device TEXT",
    "ALTER TABLE users ADD COLUMN total_online_ms INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE transactions ADD COLUMN operator_id INTEGER",
    "ALTER TABLE transactions ADD COLUMN note TEXT",
    "ALTER TABLE transactions ADD COLUMN owner_id INTEGER",
    "ALTER TABLE users ADD COLUMN can_host INTEGER NOT NULL DEFAULT 0",   // 房主权限（后台授予）
    "ALTER TABLE users ADD COLUMN max_rooms INTEGER NOT NULL DEFAULT 0",  // 最多同时开几间私人房   // 私房积分流水：所属房主；NULL = 大厅积分
  ]) {
    try { db.exec(sql); } catch (e: any) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
}
