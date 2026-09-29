// 端到端流程测试：独立临时数据目录 + 模拟 AI，覆盖商户购买 → 游客下单制作 → 商户提现 → 管理员审核打款
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenic-test-'));
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
    // Windows 下个别文件句柄释放较慢，残留的临时目录不影响结果
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
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
const ok = async (...args) => {
  const r = await call(...args);
  assert.ok(r.status < 300, `${args[1]} ${args[2]} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const login = async (username, password) => (await ok(null, 'POST', '/auth/login', { username, password })).token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitOrder(token, id) {
  for (let i = 0; i < 200; i++) {
    const o = await ok(token, 'GET', `/orders/${id}`);
    if (['SUCCESS', 'FAILED'].includes(o.status)) return o;
    await sleep(100);
  }
  throw new Error('订单超时');
}

async function personPhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#c9a27e"/><circle cx="300" cy="200" r="110" fill="#f1d2b6"/><rect x="170" y="330" width="260" height="520" rx="60" fill="#3b6ea5"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

test('三种身份完整业务流程', async (t) => {
  const merchant = await login('trial_merchant', 'cs6fH9o_RoXVrjIDKhz5');
  const visitor = await login('trial_user', '4l4pXByvM9UB__RayrW6');
  const admin = await login('trial_admin', 'XPEhwjxDl3Po5bZFm1hq');

  await t.test('错误密码无法登录', async () => {
    const r = await call(null, 'POST', '/auth/login', { username: 'trial_user', password: 'wrong' });
    assert.equal(r.status, 401);
  });

  const me = await ok(merchant, 'GET', '/auth/me');
  assert.equal(me.user.role, 'merchant');
  assert.equal(me.merchantScene.name, '老君山');
  const sceneId = me.merchantScene.id;

  const photoQuota = async () => (await ok(merchant, 'GET', '/merchant/overview')).scene.services.find((s) => s.type === 'OUTFIT_PHOTO').quota;

  // 1. 商户购买照片服务次数并模拟支付
  const before = await photoQuota();
  const purchase = await ok(merchant, 'POST', '/merchant/purchases', { serviceType: 'OUTFIT_PHOTO', count: 5 });
  assert.equal(purchase.amount, 150); // 0.30 × 5
  assert.equal(purchase.status, 'PENDING');
  await ok(merchant, 'POST', `/merchant/purchases/${purchase.id}/pay`);
  assert.equal(await photoQuota(), before + 5);
  const paidTwice = await call(merchant, 'POST', `/merchant/purchases/${purchase.id}/pay`);
  assert.equal(paidTwice.status, 409, '重复支付应被拒绝');

  // 2. 游客上传人物、选择模板、模拟支付、等待制作
  const form = new FormData();
  form.append('body', new Blob([await personPhoto()], { type: 'image/jpeg' }), 'body.jpg');
  form.append('name', '测试人物');
  form.append('consent', 'true');
  const character = await ok(visitor, 'POST', '/characters', form);

  const templates = await ok(visitor, 'GET', `/scenes/${sceneId}/templates?type=OUTFIT_PHOTO`);
  const tpl = templates[0];
  assert.equal(tpl.price, 190);
  const order = await ok(visitor, 'POST', '/orders', { templateId: tpl.id, characterId: character.id, consent: true });
  assert.equal(order.status, 'PENDING');
  assert.equal(await photoQuota(), before + 5, '未支付不扣次数');
  await ok(visitor, 'POST', `/orders/${order.id}/pay`);
  assert.equal(await photoQuota(), before + 4, '支付后扣 1 次');
  const done = await waitOrder(visitor, order.id);
  assert.equal(done.status, 'SUCCESS', done.error);
  assert.ok(done.resultUrl);
  const img = await fetch(base.replace('/api', '') + done.resultUrl);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type'), /image/);
  const unsigned = await fetch(base.replace('/api', '') + done.resultUrl.split('?')[0]);
  assert.equal(unsigned.status, 403, '私有作品必须带签名访问');

  // 打卡合拍 + 视频
  const checkin = (await ok(visitor, 'GET', `/scenes/${sceneId}/templates?type=CHECKIN`))[0];
  const o2 = await ok(visitor, 'POST', '/orders', { templateId: checkin.id, characterId: character.id, consent: true });
  await ok(visitor, 'POST', `/orders/${o2.id}/pay`);
  assert.equal((await waitOrder(visitor, o2.id)).status, 'SUCCESS');
  const video = (await ok(visitor, 'GET', `/scenes/${sceneId}/templates?type=OUTFIT_VIDEO`))[0];
  const o3 = await ok(visitor, 'POST', '/orders', { templateId: video.id, characterId: character.id, consent: true });
  await ok(visitor, 'POST', `/orders/${o3.id}/pay`);
  const v = await waitOrder(visitor, o3.id);
  assert.equal(v.status, 'SUCCESS', v.error);
  assert.equal(v.resultKind, 'video');

  // 点赞收藏
  const like = await ok(visitor, 'POST', `/templates/${tpl.id}/like`);
  assert.equal(like.active, true);
  await ok(visitor, 'POST', `/templates/${tpl.id}/favorite`);
  assert.equal((await ok(visitor, 'GET', '/favorites')).length, 1);

  // 3. 商户收入增加并申请提现
  let wallet = (await ok(merchant, 'GET', '/merchant/wallet')).wallet;
  assert.equal(wallet.income, 190 + 90 + 990);
  assert.equal(wallet.available, 1270);
  const tooMuch = await call(merchant, 'POST', '/merchant/withdrawals', { amount: '100.00' });
  assert.equal(tooMuch.status, 409);
  const w1 = await ok(merchant, 'POST', '/merchant/withdrawals', { amount: '10.00', note: '测试' });
  wallet = (await ok(merchant, 'GET', '/merchant/wallet')).wallet;
  assert.equal(wallet.frozen, 1000);
  assert.equal(wallet.available, 270);

  const usage = await ok(merchant, 'GET', '/merchant/template-usage?days=7');
  assert.equal(usage.totals.success, 3);

  // 4. 管理员审核通过 → 模拟打款
  const list = await ok(admin, 'GET', `/admin/withdrawals?sceneId=${sceneId}&status=open`);
  assert.equal(list.list[0].id, w1.id);
  const payEarly = await call(admin, 'POST', `/admin/withdrawals/${w1.id}/pay`);
  assert.equal(payEarly.status, 409, '未审核不能打款');
  await ok(admin, 'POST', `/admin/withdrawals/${w1.id}/approve`, { note: '核对无误' });
  await ok(admin, 'POST', `/admin/withdrawals/${w1.id}/pay`);
  wallet = (await ok(merchant, 'GET', '/merchant/wallet')).wallet;
  assert.equal(wallet.withdrawn, 1000);
  assert.equal(wallet.frozen, 0);

  // 驳回后冻结金额释放
  const w2 = await ok(merchant, 'POST', '/merchant/withdrawals', { amount: '2.70' });
  assert.equal((await ok(merchant, 'GET', '/merchant/wallet')).wallet.available, 0);
  const noNote = await call(admin, 'POST', `/admin/withdrawals/${w2.id}/reject`, {});
  assert.equal(noNote.status, 400, '驳回必须填写原因');
  await ok(admin, 'POST', `/admin/withdrawals/${w2.id}/reject`, { note: '信息不全' });
  wallet = (await ok(merchant, 'GET', '/merchant/wallet')).wallet;
  assert.equal(wallet.frozen, 0);
  assert.equal(wallet.available, 270);

  // 制作失败自动退款并回补次数
  await ok(admin, 'PUT', '/admin/settings', { mockFailRate: 100 });
  const q0 = await photoQuota();
  const o4 = await ok(visitor, 'POST', '/orders', { templateId: tpl.id, characterId: character.id, consent: true });
  await ok(visitor, 'POST', `/orders/${o4.id}/pay`);
  const failed = await waitOrder(visitor, o4.id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.refundAmount, 190);
  assert.equal(await photoQuota(), q0, '失败后次数回补');
  assert.equal((await ok(merchant, 'GET', '/merchant/wallet')).wallet.income, 1270, '失败订单不计收入');
  await ok(admin, 'PUT', '/admin/settings', { mockFailRate: 0 });

  // 次数耗尽后停止接单
  const vq = (await ok(merchant, 'GET', '/merchant/overview')).scene.services.find((s) => s.type === 'OUTFIT_VIDEO').quota;
  await ok(admin, 'POST', `/admin/scenes/${sceneId}/quota`, { serviceType: 'OUTFIT_VIDEO', delta: -vq, note: '测试清零' });
  const stopped = await call(visitor, 'POST', '/orders', { templateId: video.id, characterId: character.id, consent: true });
  assert.equal(stopped.status, 409);
  assert.match(stopped.body.message, /额度/);

  // 服务停用 / 景区暂停
  await ok(admin, 'PUT', `/admin/scenes/${sceneId}/services/CHECKIN`, { enabled: false });
  assert.equal((await call(visitor, 'POST', '/orders', { templateId: checkin.id, characterId: character.id, consent: true })).status, 409);
  await ok(admin, 'PUT', `/admin/scenes/${sceneId}/services/CHECKIN`, { enabled: true });

  // 一景区一商户：未结清不能解绑；已绑定景区不能再绑其他商户
  const unbind = await call(admin, 'POST', `/admin/scenes/${sceneId}/unbind`);
  assert.equal(unbind.status, 409);
  const scenes = await ok(admin, 'GET', '/admin/scenes');
  const other = scenes.find((s) => !s.bound);
  const merchantUser = me.user.id;
  const dup = await call(admin, 'POST', `/admin/scenes/${other.id}/bind`, { merchantUserId: merchantUser });
  assert.equal(dup.status, 409);

  // 权限隔离
  assert.equal((await call(visitor, 'GET', '/merchant/overview')).status, 403);
  assert.equal((await call(merchant, 'GET', '/admin/overview')).status, 403);
  assert.equal((await call(merchant, 'GET', `/orders/${order.id}`)).status, 403);

  // 客服工单：关联订单的工单由订单所属商户处理
  const ticket = await ok(visitor, 'POST', '/tickets', { title: '取件咨询', content: '请问照片在哪里取？', orderId: order.id });
  const handle = await ok(merchant, 'GET', '/tickets?scope=handle');
  assert.equal(handle.list[0].id, ticket.id);
  await ok(merchant, 'POST', `/tickets/${ticket.id}/messages`, { content: '可在我的作品中直接下载' });
  assert.equal((await ok(visitor, 'GET', `/tickets/${ticket.id}`)).status, 'REPLIED');

  const overview = await ok(admin, 'GET', `/admin/overview?sceneId=${sceneId}`);
  assert.equal(overview.orders.success, 3);
  assert.equal(overview.orders.cost, 25 + 0 + 120);

  // 管理员替景区购买次数、修改现场服务设置
  const before2 = (await ok(admin, 'GET', '/admin/scenes')).find((s) => s.id === sceneId).services.find((s) => s.type === 'CHECKIN').quota;
  const afterBuy = await ok(admin, 'POST', `/admin/scenes/${sceneId}/purchase`, { serviceType: 'CHECKIN', count: 10 });
  assert.equal(afterBuy.services.find((s) => s.type === 'CHECKIN').quota, before2 + 10);
  const svc = await ok(admin, 'PUT', `/admin/scenes/${sceneId}/service`, { printEnabled: true, pickupAddress: '中天门服务台', serviceHours: '09:00–17:00' });
  assert.equal(svc.printEnabled, true);
  assert.equal(svc.pickupAddress, '中天门服务台');
});
