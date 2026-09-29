// 打印履约、兑换码积分、登录验证码
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenic-extras-'));
process.env.DATA_DIR = dataDir;
process.env.MOCK_SPEED = '0.02';
process.env.AI_PROVIDER = 'mock';

const { seed } = await import('../seed.js');
await seed({ log: () => {} });
const { createApp } = await import('../app.js');
const { startWorker, stopWorker } = await import('../ai/worker.js');
const sharp = (await import('sharp')).default;

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  startWorker();
});
after(async () => {
  stopWorker();
  server?.close();
  (await import('../db.js')).db.close();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows 句柄释放较慢 */
  }
});

async function call(token, method, url, body) {
  const init = { method, headers: {} };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + url, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const ok = async (...args) => {
  const r = await call(...args);
  assert.ok(r.status < 300, `${args[1]} ${args[2]} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const login = async (u, p) => (await ok(null, 'POST', '/auth/login', { username: u, password: p })).token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('打印履约：申请 → 可取件 → 核对取件码', async () => {
  const visitor = await login('trial_user', '4l4pXByvM9UB__RayrW6');
  const merchant = await login('trial_merchant', 'cs6fH9o_RoXVrjIDKhz5');
  const sceneId = (await ok(merchant, 'GET', '/auth/me')).merchantScene.id;

  const form = new FormData();
  const img = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#88aacc' } }).jpeg().toBuffer();
  form.append('body', new Blob([img], { type: 'image/jpeg' }), 'b.jpg');
  form.append('consent', 'true');
  const ch = await ok(visitor, 'POST', '/characters', form);
  const tpl = (await ok(visitor, 'GET', `/scenes/${sceneId}/templates?type=CHECKIN`))[0];
  const o = await ok(visitor, 'POST', '/orders', { templateId: tpl.id, characterId: ch.id, consent: true });
  await ok(visitor, 'POST', `/orders/${o.id}/pay`);
  for (let i = 0; i < 100 && (await ok(visitor, 'GET', `/orders/${o.id}`)).status !== 'SUCCESS'; i++) await sleep(100);

  // 商户未开放时不能申请
  assert.equal((await call(visitor, 'POST', '/prints', { orderId: o.id, paper: '6寸', copies: 1 })).status, 409);
  assert.equal((await call(merchant, 'PUT', '/merchant/settings', { printEnabled: true, pickupAddress: '' })).status, 400, '开放打印须填取件地点');
  await ok(merchant, 'PUT', '/merchant/settings', { printEnabled: true, pickupAddress: '金顶游客中心' });

  assert.equal((await call(visitor, 'POST', '/prints', { orderId: o.id, paper: '6寸', copies: 11 })).status, 400);
  const p = await ok(visitor, 'POST', '/prints', { orderId: o.id, paper: '7寸', copies: 2, note: '要亮面' });
  assert.match(p.pickupCode, /^\d{6}$/);
  assert.equal((await call(visitor, 'POST', '/prints', { orderId: o.id, paper: '6寸', copies: 1 })).status, 409, '同一作品不能重复申请');

  const list = await ok(merchant, 'GET', '/print-staff?status=PENDING');
  assert.equal(list.list[0].id, p.id);
  assert.equal(list.list[0].pickupCode, null, '商户看不到取件码');
  assert.ok(list.list[0].resultUrl, '商户可下载原图');

  assert.equal((await call(merchant, 'POST', `/print-staff/${p.id}/pickup`, { code: p.pickupCode })).status, 409, '未打印不能核销');
  await ok(merchant, 'POST', `/print-staff/${p.id}/ready`);
  assert.equal((await call(merchant, 'POST', `/print-staff/${p.id}/pickup`, { code: '000000' })).status, 400);
  const done = await ok(merchant, 'POST', `/print-staff/${p.id}/pickup`, { code: p.pickupCode });
  assert.equal(done.status, 'PICKED');
});

test('兑换码：额度、生成、兑换、撤销退回', async () => {
  const admin = await login('trial_admin', 'XPEhwjxDl3Po5bZFm1hq');
  const merchant = await login('trial_merchant', 'cs6fH9o_RoXVrjIDKhz5');
  const visitor = await login('trial_user', '4l4pXByvM9UB__RayrW6');
  const mid = (await ok(merchant, 'GET', '/auth/me')).user.id;

  assert.equal((await call(merchant, 'POST', '/codes', { count: 2, points: 50, days: 7 })).status, 409, '无额度不能发行');
  await ok(admin, 'POST', '/codes/quota', { userId: mid, delta: 200 });
  const batch = await ok(merchant, 'POST', '/codes', { count: 2, points: 50, days: 7 });
  assert.equal(batch.codes.length, 2);
  assert.equal((await ok(merchant, 'GET', '/codes')).quota, 100);

  const r = await ok(visitor, 'POST', '/points/redeem', { code: batch.codes[0].toLowerCase() });
  assert.equal(r.points, 50);
  assert.equal((await ok(visitor, 'POST', '/points/redeem', { code: batch.codes[0] })).replayed, true);
  assert.equal((await ok(visitor, 'GET', '/points')).balance, 50);

  const codes = await ok(merchant, 'GET', '/codes?status=ACTIVE');
  await ok(merchant, 'POST', `/codes/${codes.list[0].id}/revoke`);
  assert.equal((await ok(merchant, 'GET', '/codes')).quota, 150, '撤销后额度退回');
  assert.equal((await call(visitor, 'POST', '/points/redeem', { code: batch.codes[1] })).status, 409, '撤销后不可兑换');
});

test('验证码开启后登录必须校验', async () => {
  const admin = await login('trial_admin', 'XPEhwjxDl3Po5bZFm1hq');
  await ok(admin, 'PUT', '/admin/settings', { captchaEnabled: true });
  const cap = await ok(null, 'GET', '/auth/captcha');
  assert.equal(cap.enabled, true);
  assert.match(cap.img, /^data:image\/svg\+xml;base64,/);
  const r = await call(null, 'POST', '/auth/login', { username: 'trial_user', password: '4l4pXByvM9UB__RayrW6' });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /验证码/);
  await ok(admin, 'PUT', '/admin/settings', { captchaEnabled: false });
  await login('trial_user', '4l4pXByvM9UB__RayrW6');
});
