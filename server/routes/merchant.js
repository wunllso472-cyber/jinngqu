// 商户端：景区额度购买、模板使用统计、游客消费收入、模拟提现
import { Router } from 'express';
import { all, one, run, scalar, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { SERVICES } from '../constants.js';
import { adjustQuota, merchantWallet, orderView, sceneView } from '../domain.js';
import { fileUrl } from '../storage.js';
import { audit, bad, conflict, dateOnly, h, intIn, notFound, now, page, parseYuan, serialNo, str } from '../util.js';
import { merchantScene } from './helpers.js';

const r = Router();
r.use(requireRole('merchant', 'admin'));

function requireScene(req) {
  const scene = merchantScene(req.user.id);
  if (!scene) throw conflict('尚未绑定景区，请联系管理员', 'NOT_BOUND');
  return scene;
}

export const purchaseView = (p) => ({
  id: p.id,
  purchaseNo: p.purchase_no,
  sceneId: p.scene_id,
  merchantId: p.merchant_id,
  serviceType: p.service_type,
  serviceName: SERVICES[p.service_type]?.name,
  count: p.count,
  unitPrice: p.unit_price,
  amount: p.amount,
  status: p.status,
  createdAt: p.created_at,
  paidAt: p.paid_at,
});

export const withdrawalView = (w) => {
  const m = one('SELECT id, username, nickname FROM users WHERE id = ?', w.merchant_id);
  const s = w.scene_id ? one('SELECT id, name FROM scenes WHERE id = ?', w.scene_id) : null;
  return {
    id: w.id,
    withdrawalNo: w.withdrawal_no,
    merchant: m && { id: m.id, username: m.username, nickname: m.nickname },
    scene: s && { id: s.id, name: s.name },
    amount: w.amount,
    note: w.note,
    status: w.status,
    reviewNote: w.review_note,
    createdAt: w.created_at,
    reviewedAt: w.reviewed_at,
    paidAt: w.paid_at,
  };
};

r.get('/overview', (req, res) => {
  const scene = merchantScene(req.user.id);
  const wallet = merchantWallet(req.user.id);
  if (!scene) return res.json({ bound: false, wallet });
  const today = dateOnly();
  const todayStats = one(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount FROM orders
     WHERE merchant_id = ? AND status = 'SUCCESS' AND substr(finished_at,1,10) = ?`,
    req.user.id,
    today,
  );
  const templates = scalar("SELECT COUNT(*) FROM templates WHERE scene_id = ? AND status = 'ON'", scene.id);
  res.json({ bound: true, scene: sceneView(scene, { withMerchant: true }), wallet, today: todayStats, templates });
});

r.put(
  '/settings',
  h(async (req, res) => {
    const scene = requireScene(req);
    if (req.body?.expectMerchantId != null && Number(req.body.expectMerchantId) !== scene.merchant_id) throw conflict('商户已变化，请重新查询后保存');
    const printEnabled = req.body?.printEnabled != null ? (req.body.printEnabled ? 1 : 0) : scene.print_enabled;
    const pickupAddress = str(req.body?.pickupAddress ?? scene.pickup_address, 300);
    if (printEnabled && !pickupAddress) throw bad('开放打印申请时必须填写取件地点');
    run(
      'UPDATE scenes SET merchant_name = ?, service_phone = ?, service_hours = ?, print_enabled = ?, pickup_address = ? WHERE id = ?',
      str(req.body?.merchantName ?? scene.merchant_name, 40),
      str(req.body?.servicePhone ?? scene.service_phone, 30),
      str(req.body?.serviceHours ?? scene.service_hours, 40),
      printEnabled,
      pickupAddress,
      scene.id,
    );
    audit(req.user.id, 'MERCHANT_SETTINGS', `scene:${scene.id}`, req.body);
    res.json(sceneView(one('SELECT * FROM scenes WHERE id = ?', scene.id), { withMerchant: true }));
  }),
);

// ---------- 购买景区服务次数（模拟支付） ----------
r.post(
  '/purchases',
  h(async (req, res) => {
    const scene = requireScene(req);
    const type = req.body?.serviceType;
    if (!SERVICES[type]) throw bad('请选择服务类型');
    const count = intIn(req.body?.count, 1, 10000);
    if (!count) throw bad('购买次数须为 1–10000 的整数');
    const svc = one('SELECT * FROM scene_services WHERE scene_id = ? AND service_type = ?', scene.id, type);
    if (!svc) throw bad('景区未开通该服务');
    const id = run(
      "INSERT INTO quota_purchases (purchase_no, scene_id, merchant_id, service_type, count, unit_price, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)",
      serialNo('QP'),
      scene.id,
      req.user.id,
      type,
      count,
      svc.merchant_price,
      svc.merchant_price * count,
      now(),
    ).lastInsertRowid;
    res.json(purchaseView(one('SELECT * FROM quota_purchases WHERE id = ?', id)));
  }),
);

function ownPurchase(req) {
  const p = one('SELECT * FROM quota_purchases WHERE id = ? AND merchant_id = ?', Number(req.params.id), req.user.id);
  if (!p) throw notFound('购买记录不存在');
  return p;
}

r.post(
  '/purchases/:id/pay',
  h(async (req, res) => {
    const p = ownPurchase(req);
    tx(() => {
      const fresh = one('SELECT * FROM quota_purchases WHERE id = ?', p.id);
      if (fresh.status !== 'PENDING') throw conflict('订单状态已变化，请刷新');
      run("UPDATE quota_purchases SET status = 'PAID', paid_at = ? WHERE id = ?", now(), p.id);
      adjustQuota(p.scene_id, p.service_type, p.count, 'PURCHASE', p.purchase_no, req.user.id);
    });
    audit(req.user.id, 'QUOTA_PURCHASE_PAID', p.purchase_no, { type: p.service_type, count: p.count, amount: p.amount });
    res.json(purchaseView(one('SELECT * FROM quota_purchases WHERE id = ?', p.id)));
  }),
);

r.post(
  '/purchases/:id/cancel',
  h(async (req, res) => {
    const p = ownPurchase(req);
    if (p.status !== 'PENDING') throw conflict('只有待支付的购买可以取消');
    run("UPDATE quota_purchases SET status = 'CANCELLED' WHERE id = ?", p.id);
    res.json(purchaseView(one('SELECT * FROM quota_purchases WHERE id = ?', p.id)));
  }),
);

r.get('/purchases', (req, res) => {
  const { size, offset, page: p } = page(req);
  const total = scalar('SELECT COUNT(*) FROM quota_purchases WHERE merchant_id = ?', req.user.id);
  const list = all('SELECT * FROM quota_purchases WHERE merchant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', req.user.id, size, offset);
  res.json({ list: list.map(purchaseView), total, page: p, size });
});

r.get('/quota-logs', (req, res) => {
  const scene = requireScene(req);
  const { size, offset, page: p } = page(req);
  const total = scalar('SELECT COUNT(*) FROM quota_logs WHERE scene_id = ?', scene.id);
  const list = all('SELECT * FROM quota_logs WHERE scene_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', scene.id, size, offset);
  res.json({
    list: list.map((l) => ({ ...l, serviceName: SERVICES[l.service_type]?.name })),
    total,
    page: p,
    size,
  });
});

// ---------- 模板使用情况 ----------
export function templateUsage(sceneId, days, merchantId = null) {
  const since = days > 0 ? dateOnly(new Date(Date.now() - (days - 1) * 86400_000)) : '0000-00-00';
  const mFilter = merchantId ? ' AND o.merchant_id = ?' : '';
  const mParams = merchantId ? [merchantId] : [];
  const rows = all(
    `SELECT t.id, t.title, t.service_type, t.cover, t.status,
       COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 END), 0) AS success,
       COALESCE(SUM(CASE WHEN o.status = 'FAILED' THEN 1 END), 0) AS failed,
       COALESCE(SUM(CASE WHEN o.status IN ('QUEUED','PROCESSING') THEN 1 END), 0) AS processing,
       COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount END), 0) AS revenue,
       COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.unit_cost END), 0) AS cost
     FROM templates t
     LEFT JOIN orders o ON o.template_id = t.id AND substr(COALESCE(o.paid_at, o.created_at),1,10) >= ?${mFilter}
     WHERE t.scene_id = ? AND t.status != 'ARCHIVED'
     GROUP BY t.id ORDER BY success DESC, t.id`,
    since,
    ...mParams,
    sceneId,
  );
  const trend = all(
    `SELECT substr(o.finished_at,1,10) AS date, COUNT(*) AS success, SUM(o.amount) AS revenue
     FROM orders o WHERE o.scene_id = ? AND o.status = 'SUCCESS' AND substr(o.finished_at,1,10) >= ?${mFilter}
     GROUP BY date ORDER BY date`,
    sceneId,
    since,
    ...mParams,
  );
  const templates = rows.map((t) => ({
    id: t.id,
    title: t.title,
    serviceType: t.service_type,
    serviceName: SERVICES[t.service_type]?.name,
    cover: fileUrl(t.cover),
    status: t.status,
    success: t.success,
    failed: t.failed,
    processing: t.processing,
    revenue: t.revenue,
    cost: t.cost,
    likes: scalar('SELECT COUNT(*) FROM likes WHERE template_id = ?', t.id),
    favorites: scalar('SELECT COUNT(*) FROM favorites WHERE template_id = ?', t.id),
  }));
  const totals = templates.reduce(
    (acc, t) => ({ success: acc.success + t.success, failed: acc.failed + t.failed, revenue: acc.revenue + t.revenue, cost: acc.cost + t.cost }),
    { success: 0, failed: 0, revenue: 0, cost: 0 },
  );
  return { since: days > 0 ? since : null, templates, trend, totals };
}

r.get('/template-usage', (req, res) => {
  const scene = requireScene(req);
  const days = [0, 7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.json(templateUsage(scene.id, days, req.user.id));
});

// ---------- 游客消费流水 ----------
r.get('/orders', (req, res) => {
  const { size, offset, page: p } = page(req);
  const where = ['merchant_id = ?'];
  const params = [req.user.id];
  if (['SUCCESS', 'FAILED', 'PROCESSING', 'QUEUED'].includes(req.query.status)) {
    where.push('status = ?');
    params.push(req.query.status);
  } else {
    where.push("status IN ('QUEUED','PROCESSING','SUCCESS','FAILED')");
  }
  if (SERVICES[req.query.type]) {
    where.push('service_type = ?');
    params.push(req.query.type);
  }
  const w = where.join(' AND ');
  const total = scalar(`SELECT COUNT(*) FROM orders WHERE ${w}`, ...params);
  const list = all(`SELECT * FROM orders WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, size, offset);
  res.json({
    list: list.map((o) => {
      const v = orderView(o, { withUser: true });
      delete v.resultUrl; // 商户不查看游客作品原图
      delete v.character;
      delete v.provider;
      return v;
    }),
    total,
    page: p,
    size,
  });
});

// ---------- 钱包与提现 ----------
r.get('/wallet', (req, res) => {
  const { size, offset, page: p } = page(req, 10);
  const total = scalar('SELECT COUNT(*) FROM withdrawals WHERE merchant_id = ?', req.user.id);
  const list = all('SELECT * FROM withdrawals WHERE merchant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', req.user.id, size, offset);
  res.json({ wallet: merchantWallet(req.user.id), withdrawals: { list: list.map(withdrawalView), total, page: p, size } });
});

r.post(
  '/withdrawals',
  h(async (req, res) => {
    const scene = merchantScene(req.user.id);
    const amount = parseYuan(req.body?.amount);
    if (!amount || amount <= 0) throw bad('请输入大于0的金额，最多两位小数');
    const note = str(req.body?.note, 100);
    const id = tx(() => {
      const wallet = merchantWallet(req.user.id);
      if (amount > wallet.available) throw conflict('可提现余额不足');
      return run(
        "INSERT INTO withdrawals (withdrawal_no, merchant_id, scene_id, amount, note, status, created_at) VALUES (?, ?, ?, ?, ?, 'REQUESTED', ?)",
        serialNo('WD'),
        req.user.id,
        scene?.id ?? null,
        amount,
        note,
        now(),
      ).lastInsertRowid;
    });
    audit(req.user.id, 'WITHDRAW_REQUEST', `withdrawal:${id}`, { amount });
    res.json(withdrawalView(one('SELECT * FROM withdrawals WHERE id = ?', id)));
  }),
);

r.post(
  '/withdrawals/:id/cancel',
  h(async (req, res) => {
    const w = one('SELECT * FROM withdrawals WHERE id = ? AND merchant_id = ?', Number(req.params.id), req.user.id);
    if (!w) throw notFound('提现记录不存在');
    const changed = run("UPDATE withdrawals SET status = 'CANCELLED', reviewed_at = ? WHERE id = ? AND status = 'REQUESTED'", now(), w.id).changes;
    if (!changed) throw conflict('只有待审核的申请可以撤销');
    audit(req.user.id, 'WITHDRAW_CANCEL', `withdrawal:${w.id}`);
    res.json(withdrawalView(one('SELECT * FROM withdrawals WHERE id = ?', w.id)));
  }),
);

export default r;
