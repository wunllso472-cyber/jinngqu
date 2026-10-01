import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { one, run } from './db.js';
import { ApiError, forbidden, now } from './util.js';

const SCRYPT_N = 16384;
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, { N: SCRYPT_N });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: SCRYPT_N });
  return crypto.timingSafeEqual(expected, actual);
}

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + config.sessionDays * 86400_000;
  run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', tokenHash(token), userId, now(), expires);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return token;
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', tokenHash(token));
}

export function destroyUserSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

function readToken(req) {
  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname || u.username,
    role: u.role,
    status: u.status,
    points: u.points ?? 0,
    codeQuota: u.role === 'merchant' ? (u.code_quota ?? 0) : undefined,
    merchantName: u.merchant_name || '',
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

/** 解析登录态（可选）：req.user / req.token */
export function loadUser(req, _res, next) {
  const token = readToken(req);
  req.user = null;
  if (token) {
    const row = one(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
      tokenHash(token),
      Date.now(),
    );
    if (row && row.status === 'ENABLED') {
      req.user = row;
      req.token = token;
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new ApiError(401, '请先登录'));
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, '请先登录'));
    if (!roles.includes(req.user.role)) return next(forbidden('当前账号没有该权限'));
    next();
  };

// 简单的登录失败限流：同一账号或 IP 10 分钟内失败 10 次后锁定
const failures = new Map();
const WINDOW = 10 * 60 * 1000;
export function checkLoginThrottle(key) {
  const rec = failures.get(key);
  if (rec && rec.count >= 10 && Date.now() - rec.first < WINDOW) {
    throw new ApiError(429, '登录失败次数过多，请 10 分钟后再试');
  }
}
export function recordLoginFailure(key) {
  const rec = failures.get(key);
  if (!rec || Date.now() - rec.first > WINDOW) failures.set(key, { count: 1, first: Date.now() });
  else rec.count++;
}
export function clearLoginFailure(key) {
  failures.delete(key);
}
