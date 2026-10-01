// 游客端：人物模板、白模上传、下单 / 模拟支付、作品与订单
import { Router } from 'express';
import { all, one, run, scalar, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { SERVICES } from '../constants.js';
import { adjustQuota, orderView, serviceAvailability, standardCost, templatePrice } from '../domain.js';
import { fileUrl, removeKey, saveImage } from '../storage.js';
import { bad, conflict, forbidden, h, notFound, now, paged, serialNo, str } from '../util.js';
import { firstFile, upload } from './helpers.js';

const r = Router();
r.use(requireAuth);

const characterView = (c) => ({
  id: c.id,
  name: c.name,
  bodyImage: fileUrl(c.body_image),
  faceImage: fileUrl(c.face_image),
  createdAt: c.created_at,
});

// ---------- 人物模板 ----------
r.get('/characters', (req, res) => {
  res.json(all("SELECT * FROM characters WHERE user_id = ? AND status = 'ACTIVE' ORDER BY id DESC", req.user.id).map(characterView));
});

r.post(
  '/characters',
  upload.fields([
    { name: 'body', maxCount: 1 },
    { name: 'face', maxCount: 1 },
  ]),
  h(async (req, res) => {
    if (!req.body?.consent || req.body.consent === 'false') throw bad('请先确认素材为本人所有或已获授权');
    const count = scalar("SELECT COUNT(*) FROM characters WHERE user_id = ? AND status = 'ACTIVE'", req.user.id);
    if (count >= 20) throw bad('人物模板最多保存 20 个，请先删除不用的模板');
    const body = await saveImage(firstFile(req, 'body'), { scope: 'private', folder: 'characters', label: '身体照片' });
    let face = null;
    const faceFile = firstFile(req, 'face');
    if (faceFile) {
      try {
        face = await saveImage(faceFile, { scope: 'private', folder: 'characters', label: '人脸照片' });
      } catch (err) {
        await removeKey(body.key);
        throw err;
      }
    }
    const name = str(req.body?.name, 20) || `人物${count + 1}`;
    const id = run(
      "INSERT INTO characters (user_id, name, body_image, face_image, status, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)",
      req.user.id,
      name,
      body.key,
      face?.key ?? null,
      now(),
    ).lastInsertRowid;
    res.json(characterView(one('SELECT * FROM characters WHERE id = ?', id)));
  }),
);

r.delete(
  '/characters/:id',
  h(async (req, res) => {
    const c = one("SELECT * FROM characters WHERE id = ? AND user_id = ? AND status = 'ACTIVE'", Number(req.params.id), req.user.id);
    if (!c) throw notFound('人物模板不存在');
    const busy = one("SELECT 1 FROM orders WHERE character_id = ? AND status IN ('PENDING','QUEUED','PROCESSING')", c.id);
    if (busy) throw conflict('该人物模板有进行中的订单，请制作完成后再删除');
    run("UPDATE characters SET status = 'DELETED' WHERE id = ?", c.id);
    // 删除人物时同步清理原始照片
    await removeKey(c.body_image);
    await removeKey(c.face_image);
    res.json({ ok: true });
  }),
);

// ---------- 游客自传白模 ----------
r.post(
  '/uploads/base',
  upload.fields([{ name: 'file', maxCount: 1 }]),
  h(async (req, res) => {
    const img = await saveImage(firstFile(req, 'file'), { scope: 'private', folder: 'bases', label: '白模场景图' });
    const id = run("INSERT INTO uploads (user_id, kind, file_key, created_at) VALUES (?, 'BASE', ?, ?)", req.user.id, img.key, now()).lastInsertRowid;
    res.json({ id, url: fileUrl(img.key) });
  }),
);

// ---------- 下单 ----------
function loadOrderable(templateId) {
  const template = one("SELECT * FROM templates WHERE id = ? AND status = 'ON'", templateId);
  if (!template) throw notFound('模板不存在或已下架');
  const scene = one('SELECT * FROM scenes WHERE id = ?', template.scene_id);
  const service = one('SELECT * FROM scene_services WHERE scene_id = ? AND service_type = ?', template.scene_id, template.service_type);
  const avail = serviceAvailability(scene, service);
  if (!avail.ok) throw conflict(avail.reason, 'SERVICE_UNAVAILABLE');
  return { template, scene, service };
}

r.post(
  '/orders',
  h(async (req, res) => {
    const { template, scene } = loadOrderable(Number(req.body?.templateId));
    const character = one("SELECT * FROM characters WHERE id = ? AND user_id = ? AND status = 'ACTIVE'", Number(req.body?.characterId), req.user.id);
    if (!character) throw bad('请选择一个人物模板');
    if (!req.body?.consent) throw bad('请先确认本人素材授权说明');

    let customBase = null;
    if (template.service_type === 'OUTFIT_PHOTO') {
      if (req.body?.baseUploadId) {
        const up = one("SELECT * FROM uploads WHERE id = ? AND user_id = ? AND kind = 'BASE'", Number(req.body.baseUploadId), req.user.id);
        if (!up) throw bad('请重新上传白模场景图');
        customBase = up.file_key;
      } else if (!template.base_image) {
        throw bad('请上传白模场景图');
      }
    }
    if (template.service_type === 'CHECKIN' && !template.background) throw conflict('该模板尚未配置背景，暂不可用');

    // 同一用户未支付订单过多时自动取消最早的
    run(
      `UPDATE orders SET status = 'CANCELLED', stage = '超时自动取消' WHERE user_id = ? AND status = 'PENDING'
       AND created_at < datetime('now', 'localtime', '-30 minutes')`,
      req.user.id,
    );

    const amount = templatePrice(template, scene.id);
    const orderNo = serialNo('SO');
    const id = run(
      `INSERT INTO orders (order_no, user_id, scene_id, merchant_id, template_id, character_id, service_type, custom_base,
        amount, unit_cost, status, stage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', '待支付', ?)`,
      orderNo,
      req.user.id,
      scene.id,
      scene.merchant_id,
      template.id,
      character.id,
      template.service_type,
      customBase,
      amount,
      standardCost(template.service_type),
      now(),
    ).lastInsertRowid;
    res.json(orderView(one('SELECT * FROM orders WHERE id = ?', id)));
  }),
);

function ownOrder(req) {
  const o = one('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
  if (!o) throw notFound('订单不存在');
  if (o.user_id !== req.user.id) throw forbidden('无权查看该订单');
  return o;
}

// 模拟支付：扣减景区次数并进入制作队列
r.post(
  '/orders/:id/pay',
  h(async (req, res) => {
    const o = ownOrder(req);
    if (o.status !== 'PENDING') throw conflict('订单状态已变化，请刷新');
    tx(() => {
      const fresh = one('SELECT * FROM orders WHERE id = ?', o.id);
      if (fresh.status !== 'PENDING') throw conflict('订单状态已变化，请刷新');
      const scene = one('SELECT * FROM scenes WHERE id = ?', o.scene_id);
      const service = one('SELECT * FROM scene_services WHERE scene_id = ? AND service_type = ?', o.scene_id, o.service_type);
      const avail = serviceAvailability(scene, service);
      if (!avail.ok) throw conflict(avail.reason, 'SERVICE_UNAVAILABLE');
      if (scene.merchant_id !== o.merchant_id) throw conflict('景区商户已变化，请重新下单');
      adjustQuota(o.scene_id, o.service_type, -1, 'CONSUME', o.order_no);
      run("UPDATE orders SET status = 'QUEUED', stage = '排队中', paid_at = ? WHERE id = ?", now(), o.id);
    });
    res.json(orderView(one('SELECT * FROM orders WHERE id = ?', o.id)));
  }),
);

r.post(
  '/orders/:id/cancel',
  h(async (req, res) => {
    const o = ownOrder(req);
    if (o.status !== 'PENDING') throw conflict('只有待支付订单可以取消');
    run("UPDATE orders SET status = 'CANCELLED', stage = '已取消模拟支付' WHERE id = ?", o.id);
    res.json(orderView(one('SELECT * FROM orders WHERE id = ?', o.id)));
  }),
);

r.get('/orders', (req, res) => {
  const where = ['user_id = ?'];
  const params = [req.user.id];
  if (req.query.status === 'active') where.push("status IN ('PENDING','QUEUED','PROCESSING')");
  else if (req.query.status === 'making') where.push("status IN ('QUEUED','PROCESSING')");
  else if (req.query.status === 'works') where.push("status IN ('QUEUED','PROCESSING','SUCCESS','FAILED')");
  else if (req.query.status) {
    where.push('status = ?');
    params.push(String(req.query.status));
  }
  const sum = one(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('QUEUED','PROCESSING','SUCCESS') THEN amount END),0) AS spent,
            COALESCE(SUM(refund_amount),0) AS refunded FROM orders WHERE user_id = ?`,
    req.user.id,
  );
  res.json({ ...paged(req, { from: 'orders', where, params, map: (o) => orderView(o) }), summary: sum });
});

r.get('/orders/:id', (req, res) => {
  res.json(orderView(ownOrder(req)));
});

// 我的作品：成功订单
r.get('/works', (req, res) => {
  const where = ['user_id = ?', "status = 'SUCCESS'"];
  const params = [req.user.id];
  if (SERVICES[req.query.type]) {
    where.push('service_type = ?');
    params.push(req.query.type);
  }
  const processing = scalar("SELECT COUNT(*) FROM orders WHERE user_id = ? AND status IN ('QUEUED','PROCESSING')", req.user.id);
  res.json({ ...paged(req, { from: 'orders', where, params, order: 'finished_at DESC', size: 24, map: (o) => orderView(o) }), processing });
});

export default r;
