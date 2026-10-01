// 商户端：景区额度购买、模板使用统计、游客消费收入、模拟提现
import { Router } from 'express';
import { one, run, scalar, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { SERVICES } from '../constants.js';
import {
  adjustQuota,
  createQuotaPurchase,
  merchantWallet,
  orderView,
  purchaseView,
  quotaLogPage,
  sceneView,
  templateUsage,
  updateServiceSettings,
  withdrawalView,
} from '../domain.js';
import { audit, bad, conflict, dateOnly, h, notFound, now, paged, parseYuan, serialNo, str } from '../util.js';
import { merchantScene } from './helpers.js';

const r = Router();
r.use(requireRole('merchant', 'admin'));

function requireScene(req) {
  const scene = merchantScene(req.user.id);
  if (!scene) throw conflict('尚未绑定景区，请联系管理员', 'NOT_BOUND');
  return scene;
}

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
    updateServiceSettings(scene, req.body);
    audit(req.user.id, 'MERCHANT_SETTINGS', `scene:${scene.id}`, req.body);
    res.json(sceneView(one('SELECT * FROM scenes WHERE id = ?', scene.id), { withMerchant: true }));
  }),
);

// ---------- 购买景区服务次数（模拟支付） ----------
r.post(
  '/purchases',
  h(async (req, res) => {
    const scene = requireScene(req);
    res.json(purchaseView(createQuotaPurchase(scene, req.user.id, req.body)));
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
  res.json(paged(req, { from: 'quota_purchases', where: ['merchant_id = ?'], params: [req.user.id], map: purchaseView }));
});

r.get('/quota-logs', (req, res) => {
  res.json(quotaLogPage(req, requireScene(req).id));
});

// ---------- 模板使用情况 ----------
r.get('/template-usage', (req, res) => {
  const scene = requireScene(req);
  res.json(templateUsage(scene.id, req.query.days, req.user.id));
});

// ---------- 游客消费流水 ----------
r.get('/orders', (req, res) => {
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
  res.json(paged(req, { from: 'orders', where, params, map: (o) => orderView(o, { audience: 'merchant' }) }));
});

// ---------- 钱包与提现 ----------
r.get('/wallet', (req, res) => {
  const withdrawals = paged(req, { from: 'withdrawals', where: ['merchant_id = ?'], params: [req.user.id], size: 10, map: withdrawalView });
  res.json({ wallet: merchantWallet(req.user.id), withdrawals });
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
