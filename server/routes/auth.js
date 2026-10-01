import { Router } from 'express';
import { one, run } from '../db.js';
import {
  checkLoginThrottle,
  clearLoginFailure,
  createSession,
  destroySession,
  hashPassword,
  publicUser,
  recordLoginFailure,
  requireAuth,
  verifyPassword,
} from '../auth.js';
import { ApiError, bad, conflict, h, now, str } from '../util.js';
import { merchantScene } from './helpers.js';
import { captchaEnabled, createCaptcha, verifyCaptcha } from '../captcha.js';

const r = Router();

r.get('/captcha', (req, res) => {
  if (!captchaEnabled()) return res.json({ enabled: false });
  res.json({ enabled: true, ...createCaptcha() });
});

export const USERNAME_RE = /^[A-Za-z0-9_]{2,20}$/;
export const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,20}$/;

function mePayload(user) {
  const payload = { user: publicUser(user) };
  if (user.role === 'merchant' || user.role === 'admin') {
    const scene = merchantScene(user.id);
    payload.merchantScene = scene ? { id: scene.id, name: scene.name } : null;
  }
  return payload;
}

// 统一登录入口：游客 / 商户 / 管理员共用
r.post(
  '/login',
  h(async (req, res) => {
    const username = str(req.body?.username, 40);
    const password = String(req.body?.password ?? '');
    if (!username || !password) throw bad('请输入账号和密码');
    const throttleKey = `${username.toLowerCase()}|${req.ip}`;
    checkLoginThrottle(throttleKey);
    verifyCaptcha(req.body?.uuid, req.body?.code);
    const user = one('SELECT * FROM users WHERE username = ?', username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      recordLoginFailure(throttleKey);
      throw new ApiError(401, '账号或密码错误');
    }
    if (user.status !== 'ENABLED') throw new ApiError(403, '账号已停用，请联系管理员');
    clearLoginFailure(throttleKey);
    run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
    const token = createSession(user.id);
    res.json({ token, ...mePayload(user) });
  }),
);

r.post(
  '/register',
  h(async (req, res) => {
    const username = str(req.body?.username, 40);
    const password = String(req.body?.password ?? '');
    if (!USERNAME_RE.test(username) || !PASSWORD_RE.test(password)) {
      throw bad('账号须为2–20位字母、数字或下划线；密码须为8–20位并包含字母和数字');
    }
    if (req.body?.confirm != null && req.body.confirm !== password) throw bad('两次密码不一致');
    if (!req.body?.agree) throw bad('请阅读并同意用户协议与隐私政策');
    verifyCaptcha(req.body?.uuid, req.body?.code);
    const passwordHash = await hashPassword(password);
    if (one('SELECT 1 FROM users WHERE username = ?', username)) throw conflict('该账号已被注册');
    const nickname = str(req.body?.nickname, 20) || username;
    run(
      "INSERT INTO users (username, password_hash, nickname, role, status, created_at) VALUES (?, ?, ?, 'visitor', 'ENABLED', ?)",
      username,
      passwordHash,
      nickname,
      now(),
    );
    res.json({ ok: true });
  }),
);

r.post('/logout', (req, res) => {
  destroySession(req.token);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => {
  res.json(mePayload(req.user));
});

r.put(
  '/me',
  requireAuth,
  h(async (req, res) => {
    const nickname = str(req.body?.nickname, 20);
    if (nickname) run('UPDATE users SET nickname = ? WHERE id = ?', nickname, req.user.id);
    if (req.body?.newPassword) {
      if (!(await verifyPassword(String(req.body.oldPassword ?? ''), req.user.password_hash))) throw bad('原密码不正确');
      if (!PASSWORD_RE.test(req.body.newPassword)) throw bad('密码须为8–20位并包含字母和数字');
      run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(req.body.newPassword), req.user.id);
    }
    res.json(mePayload(one('SELECT * FROM users WHERE id = ?', req.user.id)));
  }),
);

export default r;
