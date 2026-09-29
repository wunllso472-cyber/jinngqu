// 兑换码与积分：商户/管理员批量发行，游客兑换入账。积分不代表在线付款。
import crypto from 'node:crypto';
import { Router } from 'express';
import { all, one, run, scalar, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit, bad, conflict, forbidden, h, intIn, notFound, now, page, serialNo } from '../util.js';
import { merchantScene } from './helpers.js';
import { config } from '../config.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
const hashCode = (code) => crypto.createHmac('sha256', config.secret).update(code.toUpperCase().replace(/[\s-]/g, '')).digest('hex');

function newCode() {
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s.match(/.{4}/g).join('-');
}

const plusDays = (days) => {
  const d = new Date(Date.now() + days * 86400_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function codeStatus(c) {
  if (c.status === 'ACTIVE' && c.expires_at < now()) return 'EXPIRED';
  return c.status;
}

function codeView(c) {
  const issuer = one('SELECT id, username, nickname FROM users WHERE id = ?', c.issuer_id);
  const redeemer = c.redeemed_by ? one('SELECT id, username FROM users WHERE id = ?', c.redeemed_by) : null;
  return {
    id: c.id,
    batchNo: c.batch_no,
    tail: c.code_tail,
    points: c.points,
    status: codeStatus(c),
    issuer: issuer && { id: issuer.id, username: issuer.username, nickname: issuer.nickname },
    issuerRole: c.issuer_role,
    redeemedBy: redeemer && { id: redeemer.id, username: redeemer.username },
    expiresAt: c.expires_at,
    redeemedAt: c.redeemed_at,
    createdAt: c.created_at,
  };
}

export function addPoints(userId, change, bizType, description, ref) {
  const u = one('SELECT points FROM users WHERE id = ?', userId);
  const balance = (u?.points || 0) + change;
  if (balance < 0) throw conflict('积分不足');
  run('UPDATE users SET points = ? WHERE id = ?', balance, userId);
  run(
    'INSERT INTO points_ledger (user_id, change, balance, biz_type, description, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    change,
    balance,
    bizType,
    description,
    ref ?? null,
    now(),
  );
  return balance;
}

// ---------- 游客：兑换与积分明细 ----------
export const points = Router();
points.use(requireAuth);

points.get('/', (req, res) => {
  const { size, offset, page: p } = page(req);
  const total = scalar('SELECT COUNT(*) FROM points_ledger WHERE user_id = ?', req.user.id);
  const list = all('SELECT * FROM points_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', req.user.id, size, offset);
  const balance = one('SELECT points FROM users WHERE id = ?', req.user.id).points;
  res.json({ balance, list, total, page: p, size });
});

points.post(
  '/redeem',
  h(async (req, res) => {
    const raw = String(req.body?.code || '').trim();
    if (!raw) throw bad('请输入兑换码');
    const hash = hashCode(raw);
    const result = tx(() => {
      const c = one('SELECT * FROM redeem_codes WHERE code_hash = ?', hash);
      if (!c) throw bad('兑换码不存在，请核对后重试');
      if (c.status === 'REDEEMED') {
        if (c.redeemed_by === req.user.id) return { replayed: true, points: c.points, message: '已兑换过' };
        throw conflict('该兑换码已被使用');
      }
      if (c.status === 'REVOKED') throw conflict('该兑换码已撤销');
      if (c.expires_at < now()) throw conflict('该兑换码已过期');
      run("UPDATE redeem_codes SET status = 'REDEEMED', redeemed_by = ?, redeemed_at = ? WHERE id = ? AND status = 'ACTIVE'", req.user.id, now(), c.id);
      const balance = addPoints(req.user.id, c.points, 'REDEEM', `兑换码 ****${c.code_tail}`, c.batch_no);
      return { replayed: false, points: c.points, balance };
    });
    res.json(result);
  }),
);

// ---------- 商户 / 管理员：发行与管理 ----------
export const codes = Router();
codes.use(requireRole('merchant', 'admin'));

codes.get('/', (req, res) => {
  const { size, offset, page: p } = page(req);
  const where = [];
  const params = [];
  if (req.user.role === 'merchant') {
    where.push('issuer_id = ?');
    params.push(req.user.id);
  } else if (req.query.sceneId) {
    where.push('scene_id = ?');
    params.push(Number(req.query.sceneId));
  }
  const st = req.query.status;
  if (st === 'ACTIVE') where.push("status = 'ACTIVE' AND expires_at >= ?"), params.push(now());
  else if (st === 'EXPIRED') where.push("status = 'ACTIVE' AND expires_at < ?"), params.push(now());
  else if (['REDEEMED', 'REVOKED'].includes(st)) where.push('status = ?'), params.push(st);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = scalar(`SELECT COUNT(*) FROM redeem_codes ${w}`, ...params);
  const list = all(`SELECT * FROM redeem_codes ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, size, offset);
  const me = one('SELECT code_quota FROM users WHERE id = ?', req.user.id);
  res.json({ list: list.map(codeView), total, page: p, size, quota: req.user.role === 'admin' ? null : me.code_quota });
});

// 批量生成：明文仅在本次响应中返回
codes.post(
  '/',
  h(async (req, res) => {
    const count = intIn(req.body?.count, 1, 100);
    const pts = intIn(req.body?.points, 1, 10000);
    const days = intIn(req.body?.days, 1, 365);
    if (!count || !pts || !days) throw bad('数量1–100，积分1–10000，有效期1–365天');
    const isAdmin = req.user.role === 'admin';
    const scene = merchantScene(req.user.id);
    if (!isAdmin && !scene) throw conflict('尚未绑定景区，请联系管理员');
    const batchNo = serialNo('RC');
    const plain = [];
    tx(() => {
      if (!isAdmin) {
        const need = count * pts;
        const changed = run('UPDATE users SET code_quota = code_quota - ? WHERE id = ? AND code_quota >= ?', need, req.user.id, need).changes;
        if (!changed) throw conflict(`发放额度不足，本次需要 ${need} 积分额度`);
      }
      const t = now();
      const exp = plusDays(days);
      for (let i = 0; i < count; i++) {
        const code = newCode();
        plain.push(code);
        run(
          `INSERT INTO redeem_codes (batch_no, code_hash, code_tail, points, status, issuer_id, issuer_role, scene_id, expires_at, created_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
          batchNo,
          hashCode(code),
          code.slice(-4),
          pts,
          req.user.id,
          req.user.role,
          scene?.id ?? null,
          exp,
          t,
        );
      }
    });
    audit(req.user.id, 'CODES_ISSUE', `batch:${batchNo}`, { count, points: pts, days });
    res.json({ batchNo, codes: plain, count, points: pts, days });
  }),
);

// 撤销未使用（含已过期）的兑换码，商户发行占用的额度退回
codes.post(
  '/:id/revoke',
  h(async (req, res) => {
    const c = one('SELECT * FROM redeem_codes WHERE id = ?', Number(req.params.id));
    if (!c) throw notFound('兑换码不存在');
    if (req.user.role !== 'admin' && c.issuer_id !== req.user.id) throw forbidden();
    tx(() => {
      const changed = run("UPDATE redeem_codes SET status = 'REVOKED', revoked_at = ? WHERE id = ? AND status = 'ACTIVE'", now(), c.id).changes;
      if (!changed) throw conflict('只有未使用的兑换码可以撤销');
      if (c.issuer_role === 'merchant') run('UPDATE users SET code_quota = code_quota + ? WHERE id = ?', c.points, c.issuer_id);
    });
    audit(req.user.id, 'CODE_REVOKE', `code:${c.id}`, { points: c.points });
    res.json(codeView(one('SELECT * FROM redeem_codes WHERE id = ?', c.id)));
  }),
);

// 管理员为商户分配发放额度
codes.post(
  '/quota',
  h(async (req, res) => {
    if (req.user.role !== 'admin') throw forbidden();
    const u = one('SELECT * FROM users WHERE id = ?', Number(req.body?.userId));
    if (!u || u.role !== 'merchant') throw bad('只能给商户账号分配发放额度');
    const delta = intIn(req.body?.delta, -1_000_000, 1_000_000);
    if (!delta) throw bad('调整额度须为非零整数');
    const changed = run('UPDATE users SET code_quota = code_quota + ? WHERE id = ? AND code_quota + ? >= 0', delta, u.id, delta).changes;
    if (!changed) throw conflict('扣减后额度不能小于 0');
    audit(req.user.id, 'CODE_QUOTA', `user:${u.id}`, { delta });
    res.json({ userId: u.id, quota: one('SELECT code_quota FROM users WHERE id = ?', u.id).code_quota });
  }),
);
