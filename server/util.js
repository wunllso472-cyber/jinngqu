import crypto from 'node:crypto';
import { run } from './db.js';

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg, code) => new ApiError(400, msg, code);
export const forbidden = (msg = '没有权限') => new ApiError(403, msg);
export const notFound = (msg = '记录不存在') => new ApiError(404, msg);
export const conflict = (msg, code) => new ApiError(409, msg, code);

/** 包装 async 路由，把异常交给错误中间件 */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const pad = (n) => String(n).padStart(2, '0');
export function now(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function dateOnly(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function serialNo(prefix) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}${stamp}${crypto.randomInt(1000, 9999)}`;
}

export const yuan = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;

/** "1.90" → 190；非法返回 null */
export function parseYuan(input) {
  const s = String(input ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function intIn(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function page(req, defSize = 20) {
  const size = Math.min(100, Math.max(1, Number(req.query.size) || defSize));
  const pageNo = Math.max(1, Number(req.query.page) || 1);
  return { size, page: pageNo, offset: (pageNo - 1) * size };
}

export function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

export function audit(actorId, action, target = '', detail = '') {
  run(
    'INSERT INTO audit_logs (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)',
    actorId ?? null,
    action,
    String(target),
    typeof detail === 'string' ? detail : JSON.stringify(detail),
    now(),
  );
}
