// 打印履约：游客对成功作品申请打印凭证 → 商户下载原图、打印后标记可取件 → 到店核对取件码核销
// 应用不收取打印费用，也不控制打印机；费用与取件时间由现场商户确认。
import crypto from 'node:crypto';
import { Router } from 'express';
import { all, one, run, scalar, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { fileUrl } from '../storage.js';
import { audit, bad, conflict, forbidden, h, intIn, notFound, now, page, serialNo, str } from '../util.js';

const r = Router();
r.use(requireAuth);

export const PAPERS = ['6寸', '7寸'];

export function printView(p, { staff = false } = {}) {
  const o = one('SELECT id, order_no, template_id, result_key, result_kind, service_type FROM orders WHERE id = ?', p.order_id);
  const t = o ? one('SELECT title, cover FROM templates WHERE id = ?', o.template_id) : null;
  const s = one('SELECT id, name, pickup_address, service_phone FROM scenes WHERE id = ?', p.scene_id);
  const view = {
    id: p.id,
    requestNo: p.request_no,
    orderId: p.order_id,
    orderNo: o?.order_no,
    templateTitle: t?.title,
    cover: fileUrl(t?.cover),
    scene: s && { id: s.id, name: s.name, pickupAddress: s.pickup_address, phone: s.service_phone },
    paper: p.paper,
    copies: p.copies,
    note: p.note,
    status: p.status,
    // 取件码只给游客本人；商户需由游客现场出示后输入核对
    pickupCode: staff ? null : p.pickup_code,
    merchantNote: p.merchant_note,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    readyAt: p.ready_at,
    pickedAt: p.picked_at,
  };
  if (staff) {
    const u = one('SELECT id, username, nickname FROM users WHERE id = ?', p.user_id);
    view.user = u && { id: u.id, username: u.username, nickname: u.nickname };
    view.resultUrl = o?.result_kind === 'image' ? fileUrl(o.result_key) : null;
  }
  return view;
}

const pickupCode = () => String(crypto.randomInt(100000, 999999));

// ---------- 游客 ----------
// 某订单的打印状态（订单详情页用）
r.get('/order/:orderId', (req, res) => {
  const o = one('SELECT * FROM orders WHERE id = ? AND user_id = ?', Number(req.params.orderId), req.user.id);
  if (!o) throw notFound('订单不存在');
  const s = one('SELECT print_enabled, pickup_address, service_phone FROM scenes WHERE id = ?', o.scene_id);
  const current = one("SELECT * FROM print_requests WHERE order_id = ? AND status != 'CANCELLED' ORDER BY id DESC LIMIT 1", o.id);
  res.json({
    printable: o.status === 'SUCCESS' && o.result_kind === 'image',
    printEnabled: !!s?.print_enabled,
    pickupAddress: s?.pickup_address || '',
    phone: s?.service_phone || '',
    papers: PAPERS,
    current: current ? printView(current) : null,
  });
});

r.get('/', (req, res) => {
  const { size, offset, page: p } = page(req);
  const where = ['user_id = ?'];
  const params = [req.user.id];
  if (['PENDING', 'READY', 'PICKED', 'CANCELLED'].includes(req.query.status)) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  const w = where.join(' AND ');
  const total = scalar(`SELECT COUNT(*) FROM print_requests WHERE ${w}`, ...params);
  const list = all(`SELECT * FROM print_requests WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, size, offset);
  res.json({ list: list.map((x) => printView(x)), total, page: p, size });
});

r.post(
  '/',
  h(async (req, res) => {
    const o = one('SELECT * FROM orders WHERE id = ? AND user_id = ?', Number(req.body?.orderId), req.user.id);
    if (!o) throw notFound('订单不存在');
    if (o.status !== 'SUCCESS') throw conflict('作品制作成功后才能打印');
    if (o.result_kind !== 'image') throw conflict('视频作品不支持打印');
    const scene = one('SELECT * FROM scenes WHERE id = ?', o.scene_id);
    if (!scene?.print_enabled) throw conflict('商户尚未开放打印申请');
    if (!PAPERS.includes(req.body?.paper)) throw bad('请选择纸张规格');
    const copies = intIn(req.body?.copies, 1, 10);
    if (!copies) throw bad('打印份数应为 1–10');
    const id = tx(() => {
      if (one("SELECT 1 FROM print_requests WHERE order_id = ? AND status IN ('PENDING','READY')", o.id)) throw conflict('该作品已有进行中的打印申请');
      const t = now();
      return run(
        `INSERT INTO print_requests (request_no, order_id, user_id, scene_id, merchant_id, paper, copies, note, status, pickup_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
        serialNo('PR'),
        o.id,
        req.user.id,
        o.scene_id,
        scene.merchant_id,
        req.body.paper,
        copies,
        str(req.body?.note, 200),
        pickupCode(),
        t,
        t,
      ).lastInsertRowid;
    });
    res.json(printView(one('SELECT * FROM print_requests WHERE id = ?', id)));
  }),
);

function load(req) {
  const p = one('SELECT * FROM print_requests WHERE id = ?', Number(req.params.id));
  if (!p) throw notFound('打印申请不存在');
  const owner = p.user_id === req.user.id;
  const staff = req.user.role === 'admin' || (req.user.role === 'merchant' && p.merchant_id === req.user.id);
  if (!owner && !staff) throw forbidden('无权查看该打印申请');
  return { p, owner, staff };
}

r.get('/:id', (req, res) => {
  const { p, owner, staff } = load(req);
  res.json(printView(p, { staff: staff && !owner }));
});

// 游客修改待处理申请（份数、纸张、备注）
r.put(
  '/:id',
  h(async (req, res) => {
    const { p, owner } = load(req);
    if (!owner) throw forbidden();
    if (p.status !== 'PENDING') throw conflict('商户已处理，不能再修改');
    const paper = PAPERS.includes(req.body?.paper) ? req.body.paper : p.paper;
    const copies = req.body?.copies != null ? intIn(req.body.copies, 1, 10) : p.copies;
    if (!copies) throw bad('打印份数应为 1–10');
    run('UPDATE print_requests SET paper = ?, copies = ?, note = ?, updated_at = ? WHERE id = ?', paper, copies, str(req.body?.note ?? p.note, 200), now(), p.id);
    res.json(printView(one('SELECT * FROM print_requests WHERE id = ?', p.id)));
  }),
);

r.post(
  '/:id/cancel',
  h(async (req, res) => {
    const { p, owner, staff } = load(req);
    const t = now();
    const changed = run(
      "UPDATE print_requests SET status = 'CANCELLED', cancelled_at = ?, updated_at = ?, merchant_note = CASE WHEN ? = '' THEN merchant_note ELSE ? END WHERE id = ? AND status IN ('PENDING','READY')",
      t,
      t,
      staff && !owner ? str(req.body?.note, 200) : '',
      staff && !owner ? str(req.body?.note, 200) : '',
      p.id,
    ).changes;
    if (!changed) throw conflict('当前状态不能取消');
    res.json(printView(one('SELECT * FROM print_requests WHERE id = ?', p.id), { staff: staff && !owner }));
  }),
);

// ---------- 商户 / 管理员 ----------
export const printStaff = Router();
printStaff.use(requireAuth);
printStaff.use((req, _res, next) => (['merchant', 'admin'].includes(req.user.role) ? next() : next(forbidden())));

printStaff.get('/', (req, res) => {
  const { size, offset, page: p } = page(req);
  const where = [];
  const params = [];
  if (req.user.role === 'merchant') {
    where.push('merchant_id = ?');
    params.push(req.user.id);
  } else if (req.query.sceneId) {
    where.push('scene_id = ?');
    params.push(Number(req.query.sceneId));
  }
  if (['PENDING', 'READY', 'PICKED', 'CANCELLED'].includes(req.query.status)) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = scalar(`SELECT COUNT(*) FROM print_requests ${w}`, ...params);
  const list = all(
    `SELECT * FROM print_requests ${w} ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'READY' THEN 1 ELSE 2 END, id DESC LIMIT ? OFFSET ?`,
    ...params,
    size,
    offset,
  );
  res.json({ list: list.map((x) => printView(x, { staff: true })), total, page: p, size });
});

function staffLoad(req) {
  const p = one('SELECT * FROM print_requests WHERE id = ?', Number(req.params.id));
  if (!p) throw notFound('打印申请不存在');
  if (req.user.role === 'merchant' && p.merchant_id !== req.user.id) throw forbidden('该申请不属于你的景区');
  return p;
}

// 已完成实际打印，标记可取件
printStaff.post(
  '/:id/ready',
  h(async (req, res) => {
    const p = staffLoad(req);
    const t = now();
    const changed = run(
      "UPDATE print_requests SET status = 'READY', ready_at = ?, updated_at = ?, merchant_note = ? WHERE id = ? AND status = 'PENDING'",
      t,
      t,
      str(req.body?.note, 200),
      p.id,
    ).changes;
    if (!changed) throw conflict('申请状态已变化，请刷新');
    audit(req.user.id, 'PRINT_READY', `print:${p.id}`);
    res.json(printView(one('SELECT * FROM print_requests WHERE id = ?', p.id), { staff: true }));
  }),
);

// 核对游客出示的取件码并核销
printStaff.post(
  '/:id/pickup',
  h(async (req, res) => {
    const p = staffLoad(req);
    if (p.status !== 'READY') throw conflict('照片尚未标记可取件');
    if (String(req.body?.code || '').trim() !== p.pickup_code) throw bad('取件码不正确，请核对');
    const t = now();
    run("UPDATE print_requests SET status = 'PICKED', picked_at = ?, updated_at = ? WHERE id = ? AND status = 'READY'", t, t, p.id);
    audit(req.user.id, 'PRINT_PICKED', `print:${p.id}`);
    res.json(printView(one('SELECT * FROM print_requests WHERE id = ?', p.id), { staff: true }));
  }),
);

export default r;
