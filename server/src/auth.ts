/**
 * 账号：注册 / 登录 / JWT（HS256，node:crypto 实现，零依赖）
 * 密码：scrypt + 随机盐
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import type { DB } from './db/index.js';

export interface User {
  id: number;
  username: string;
  nickname: string;
  vipLevel: number;
  balance: number;
  role: 'player' | 'dealer' | 'admin';
  groupId: number | null;
  status: 'active' | 'frozen';
}

export interface AuthConfig {
  jwtSecret: string;
  tokenTtlSec: number;
  /** 新注册账号赠送的测试余额（演示用；生产设 0 并接充值） */
  signupBonus: number;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(payload: Record<string, unknown>, cfg: AuthConfig): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + cfg.tokenTtlSec }));
  const sig = createHmac('sha256', cfg.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string, cfg: AuthConfig): { sub: number; role: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expect = createHmac('sha256', cfg.jwtSecret).update(`${h}.${b}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { sub: payload.sub, role: payload.role };
}

export class AuthService {
  constructor(private db: DB, private cfg: AuthConfig) {}

  register(username: string, password: string, nickname?: string): User {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw new HttpError(400, '用户名需为 3-20 位字母/数字/下划线');
    if (password.length < 6) throw new HttpError(400, '密码至少 6 位');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    const now = Date.now();
    try {
      const r = this.db
        .prepare('INSERT INTO users (username, password_hash, salt, nickname, balance, created_at) VALUES (?,?,?,?,?,?)')
        .run(username, hash, salt, nickname || username, this.cfg.signupBonus, now);
      const id = Number(r.lastInsertRowid);
      if (this.cfg.signupBonus > 0) {
        this.db
          .prepare('INSERT INTO transactions (user_id, kind, amount, balance, ref, created_at) VALUES (?,?,?,?,?,?)')
          .run(id, 'deposit', this.cfg.signupBonus, this.cfg.signupBonus, 'signup bonus', now);
      }
      return this.getUser(id)!;
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, '用户名已存在');
      throw e;
    }
  }

  login(username: string, password: string, ctx?: { ip?: string; device?: string }): { user: User; token: string } {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!row) throw new HttpError(401, '用户名或密码错误');
    const hash = scryptSync(password, row.salt, 64);
    if (!timingSafeEqual(hash, Buffer.from(row.password_hash, 'hex'))) throw new HttpError(401, '用户名或密码错误');
    if (row.status === 'frozen') throw new HttpError(403, '账号已被冻结，请联系客服');
    this.db.prepare('UPDATE users SET last_login_at = ?, last_ip = COALESCE(?, last_ip), last_device = COALESCE(?, last_device) WHERE id = ?')
      .run(Date.now(), ctx?.ip ?? null, ctx?.device ?? null, row.id);
    const user = rowToUser(row);
    return { user, token: signToken({ sub: user.id, role: user.role }, this.cfg) };
  }

  /** 启动时确保存在管理员账号（ADMIN_USER / ADMIN_PASS） */
  ensureAdmin(username: string, password: string) {
    const row = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as any;
    if (row) { this.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(row.id); return; }
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    this.db.prepare("INSERT INTO users (username, password_hash, salt, nickname, balance, role, created_at) VALUES (?,?,?,?,0,'admin',?)")
      .run(username, hash, salt, '管理员', Date.now());
  }

  getUser(id: number): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    return row ? rowToUser(row) : null;
  }

  authenticate(token: string | undefined): User | null {
    if (!token) return null;
    const p = verifyToken(token, this.cfg);
    return p ? this.getUser(p.sub) : null;
  }
}

export function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    vipLevel: row.vip_level,
    balance: row.balance,
    role: row.role,
    groupId: row.group_id ?? null,
    status: row.status ?? 'active',
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
