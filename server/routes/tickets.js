// 客服工单：游客提交；关联订单的工单由订单所属商户处理，管理员可处理全部
import { Router } from 'express';
import { all, one, run, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { userBrief } from '../domain.js';
import { bad, conflict, forbidden, h, notFound, now, paged, str } from '../util.js';

const r = Router();
r.use(requireAuth);

function ticketView(t, { withMessages = false } = {}) {
  const scene = t.scene_id ? one('SELECT id, name FROM scenes WHERE id = ?', t.scene_id) : null;
  const order = t.order_id ? one('SELECT id, order_no FROM orders WHERE id = ?', t.order_id) : null;
  const last = one('SELECT content, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id DESC LIMIT 1', t.id);
  const view = {
    id: t.id,
    title: t.title,
    status: t.status,
    user: userBrief(t.user_id),
    scene,
    order: order && { id: order.id, orderNo: order.order_no },
    handler: t.merchant_id ? 'merchant' : 'admin',
    lastMessage: last?.content?.slice(0, 80) ?? '',
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
  if (withMessages) {
    view.messages = all('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id', t.id).map((m) => ({
      id: m.id,
      senderRole: m.sender_role,
      mine: false,
      senderId: m.sender_id,
      content: m.content,
      createdAt: m.created_at,
    }));
  }
  return view;
}

/** 当前用户对工单的身份：owner / staff / null */
function access(user, t) {
  if (t.user_id === user.id) return 'owner';
  if (user.role === 'admin') return 'staff';
  if (user.role === 'merchant' && t.merchant_id === user.id) return 'staff';
  return null;
}

function loadTicket(req) {
  const t = one('SELECT * FROM tickets WHERE id = ?', Number(req.params.id));
  if (!t) throw notFound('工单不存在');
  const role = access(req.user, t);
  if (!role) throw forbidden('无权查看该工单');
  return { t, role };
}

// scope=mine（我提交的）/ handle（我处理的）
r.get('/', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.scope === 'handle') {
    if (req.user.role === 'admin') {
      if (req.query.sceneId) {
        where.push('scene_id = ?');
        params.push(Number(req.query.sceneId));
      }
    } else if (req.user.role === 'merchant') {
      where.push('merchant_id = ?');
      params.push(req.user.id);
    } else throw forbidden();
  } else {
    where.push('user_id = ?');
    params.push(req.user.id);
  }
  if (['PENDING', 'REPLIED', 'CLOSED'].includes(req.query.status)) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  res.json(
    paged(req, {
      from: 'tickets',
      where,
      params,
      order: "CASE status WHEN 'PENDING' THEN 0 WHEN 'REPLIED' THEN 1 ELSE 2 END, updated_at DESC",
      map: (t) => ticketView(t),
    }),
  );
});

r.post(
  '/',
  h(async (req, res) => {
    const title = str(req.body?.title, 60);
    const content = str(req.body?.content, 2000);
    if (!title || !content) throw bad('请填写问题标题和内容');
    let sceneId = req.body?.sceneId ? Number(req.body.sceneId) : null;
    let orderId = null;
    let merchantId = null;
    if (req.body?.orderId) {
      const o = one('SELECT * FROM orders WHERE id = ? AND user_id = ?', Number(req.body.orderId), req.user.id);
      if (!o) throw bad('关联订单不存在');
      orderId = o.id;
      sceneId = o.scene_id;
      merchantId = o.merchant_id; // 交由订单所属商户处理
    }
    if (sceneId && !one('SELECT 1 FROM scenes WHERE id = ?', sceneId)) sceneId = null;
    const id = tx(() => {
      const t = now();
      const tid = run(
        "INSERT INTO tickets (user_id, scene_id, order_id, merchant_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)",
        req.user.id,
        sceneId,
        orderId,
        merchantId,
        title,
        t,
        t,
      ).lastInsertRowid;
      run('INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, content, created_at) VALUES (?, ?, ?, ?, ?)', tid, req.user.id, 'visitor', content, t);
      return tid;
    });
    res.json(ticketView(one('SELECT * FROM tickets WHERE id = ?', id), { withMessages: true }));
  }),
);

r.get('/:id', (req, res) => {
  const { t, role } = loadTicket(req);
  const view = ticketView(t, { withMessages: true });
  view.messages.forEach((m) => (m.mine = m.senderId === req.user.id));
  view.myRole = role;
  res.json(view);
});

r.post(
  '/:id/messages',
  h(async (req, res) => {
    const { t, role } = loadTicket(req);
    const content = str(req.body?.content, 2000);
    if (!content) throw bad('请输入回复内容');
    if (t.status === 'CLOSED') throw conflict('工单已关闭，请先重新打开');
    const time = now();
    const senderRole = role === 'owner' ? 'visitor' : req.user.role;
    tx(() => {
      run('INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, content, created_at) VALUES (?, ?, ?, ?, ?)', t.id, req.user.id, senderRole, content, time);
      run('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', role === 'owner' ? 'PENDING' : 'REPLIED', time, t.id);
    });
    res.json({ ok: true });
  }),
);

r.post(
  '/:id/close',
  h(async (req, res) => {
    const { t } = loadTicket(req);
    run("UPDATE tickets SET status = 'CLOSED', updated_at = ? WHERE id = ?", now(), t.id);
    res.json({ ok: true });
  }),
);

r.post(
  '/:id/reopen',
  h(async (req, res) => {
    const { t } = loadTicket(req);
    if (t.status !== 'CLOSED') throw conflict('工单未关闭');
    run("UPDATE tickets SET status = 'PENDING', updated_at = ? WHERE id = ?", now(), t.id);
    res.json({ ok: true });
  }),
);

export default r;
