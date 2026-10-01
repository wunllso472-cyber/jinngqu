// 管理员：全局模板、账号角色、景区商户绑定、服务启停、流水与成本、提现审核
import { Router } from 'express';
import { all, getSetting, one, run, scalar, setSetting, tx } from '../db.js';
import { destroyUserSessions, hashPassword, publicUser, requireRole } from '../auth.js';
import { ROLES, SERVICES, SERVICE_TYPES } from '../constants.js';
import {
  adjustQuota,
  createQuotaPurchase,
  initSceneServices,
  merchantWallet,
  orderView,
  purchaseView,
  quotaLogPage,
  sceneView,
  standardCost,
  templateUsage,
  templateView,
  updateServiceSettings,
  userBrief,
  withdrawalView,
} from '../domain.js';
import { removeKey, saveImage, saveVideo } from '../storage.js';
import { audit, bad, conflict, h, intIn, notFound, now, paged, parseYuan, str, yuan } from '../util.js';
import { firstFile, merchantScene, upload } from './helpers.js';
import { PASSWORD_RE, USERNAME_RE } from './auth.js';
import { config } from '../config.js';
import { hasFfmpeg } from '../ai/video.js';
import { providerFor } from '../ai/worker.js';

const r = Router();
r.use(requireRole('admin'));

// ---------- 总览 ----------
r.get('/overview', (req, res) => {
  const sceneId = req.query.sceneId ? Number(req.query.sceneId) : null;
  const sf = sceneId ? ' AND scene_id = ?' : '';
  const sp = sceneId ? [sceneId] : [];
  const orderRows = all(
    `SELECT service_type,
       COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) AS success,
       COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount END),0) AS revenue,
       COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN unit_cost END),0) AS cost,
       COUNT(CASE WHEN status = 'FAILED' THEN 1 END) AS failed,
       COALESCE(SUM(CASE WHEN status = 'FAILED' THEN refund_amount END),0) AS refunded,
       COUNT(CASE WHEN status IN ('QUEUED','PROCESSING') THEN 1 END) AS processing
     FROM orders WHERE status IN ('QUEUED','PROCESSING','SUCCESS','FAILED')${sf} GROUP BY service_type`,
    ...sp,
  );
  const quotaRows = all(
    `SELECT service_type, COALESCE(SUM(amount),0) AS quotaSales, COALESCE(SUM(count),0) AS quotaCount
     FROM quota_purchases WHERE status = 'PAID'${sf} GROUP BY service_type`,
    ...sp,
  );
  const sum = (rows, k) => rows.reduce((acc, x) => acc + x[k], 0);
  const byType = SERVICE_TYPES.map((type) => {
    const o = orderRows.find((x) => x.service_type === type);
    const q = quotaRows.find((x) => x.service_type === type);
    return {
      type,
      name: SERVICES[type].name,
      standardCost: standardCost(type),
      success: o?.success ?? 0,
      revenue: o?.revenue ?? 0,
      cost: o?.cost ?? 0,
      failed: o?.failed ?? 0,
      quotaSales: q?.quotaSales ?? 0,
      quotaCount: q?.quotaCount ?? 0,
    };
  });
  const roles = all('SELECT role, COUNT(*) AS n FROM users GROUP BY role');
  const withdrawals = one(
    `SELECT COUNT(CASE WHEN status IN ('REQUESTED','APPROVED') THEN 1 END) AS pending,
            COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount END),0) AS paid
     FROM withdrawals WHERE 1 = 1${sf}`,
    ...sp,
  );
  res.json({
    users: Object.fromEntries(ROLES.map((role) => [role, roles.find((x) => x.role === role)?.n ?? 0])),
    scenes: scalar('SELECT COUNT(*) FROM scenes'),
    templates: scalar("SELECT COUNT(*) FROM templates WHERE status = 'ON'"),
    orders: {
      success: sum(orderRows, 'success'),
      failed: sum(orderRows, 'failed'),
      processing: sum(orderRows, 'processing'),
      revenue: sum(orderRows, 'revenue'),
      refunded: sum(orderRows, 'refunded'),
      cost: sum(orderRows, 'cost'),
    },
    quotaSales: sum(quotaRows, 'quotaSales'),
    withdrawals,
    tickets: scalar(`SELECT COUNT(*) FROM tickets WHERE status = 'PENDING'${sf}`, ...sp),
    byType,
    runtime: {
      aiProvider: config.aiProvider,
      providers: Object.fromEntries(SERVICE_TYPES.map((t) => [t, providerFor(t).name])),
      ffmpeg: hasFfmpeg(),
    },
  });
});

// ---------- 景区与商户 ----------
r.get('/scenes', (req, res) => {
  res.json(
    all('SELECT * FROM scenes ORDER BY sort DESC, id').map((s) => ({
      ...sceneView(s, { withMerchant: true }),
      wallet: s.merchant_id ? merchantWallet(s.merchant_id) : null,
      pendingWithdrawals: scalar("SELECT COUNT(*) FROM withdrawals WHERE scene_id = ? AND status IN ('REQUESTED','APPROVED')", s.id),
    })),
  );
});

function loadScene(req) {
  const s = one('SELECT * FROM scenes WHERE id = ?', Number(req.params.id));
  if (!s) throw notFound('景区不存在');
  return s;
}

const sendScene = (res, id) => res.json(sceneView(one('SELECT * FROM scenes WHERE id = ?', id), { withMerchant: true }));

r.post(
  '/scenes',
  upload.fields([{ name: 'cover', maxCount: 1 }]),
  h(async (req, res) => {
    const name = str(req.body?.name, 30);
    if (!name) throw bad('请填写景区名称');
    const coverFile = firstFile(req, 'cover');
    const cover = coverFile ? (await saveImage(coverFile, { scope: 'public', folder: 'scenes', label: '封面' })).key : null;
    const id = tx(() => {
      const sid = run(
        "INSERT INTO scenes (name, subtitle, city, intro, cover, status, sort, created_at) VALUES (?, ?, ?, ?, ?, 'PAUSED', ?, ?)",
        name,
        str(req.body?.subtitle, 60),
        str(req.body?.city, 20),
        str(req.body?.intro, 500),
        cover,
        Number(req.body?.sort) || 0,
        now(),
      ).lastInsertRowid;
      initSceneServices(sid);
      return sid;
    });
    audit(req.user.id, 'SCENE_CREATE', `scene:${id}`, { name });
    sendScene(res, id);
  }),
);

r.put(
  '/scenes/:id',
  upload.fields([{ name: 'cover', maxCount: 1 }]),
  h(async (req, res) => {
    const s = loadScene(req);
    const coverFile = firstFile(req, 'cover');
    const cover = coverFile ? (await saveImage(coverFile, { scope: 'public', folder: 'scenes', label: '封面' })).key : s.cover;
    run(
      'UPDATE scenes SET name = ?, subtitle = ?, city = ?, intro = ?, cover = ?, sort = ? WHERE id = ?',
      str(req.body?.name, 30) || s.name,
      str(req.body?.subtitle ?? s.subtitle, 60),
      str(req.body?.city ?? s.city, 20),
      str(req.body?.intro ?? s.intro, 500),
      cover,
      req.body?.sort != null ? Number(req.body.sort) || 0 : s.sort,
      s.id,
    );
    audit(req.user.id, 'SCENE_UPDATE', `scene:${s.id}`);
    sendScene(res, s.id);
  }),
);

// 暂停 / 恢复整个景区
r.post(
  '/scenes/:id/status',
  h(async (req, res) => {
    const s = loadScene(req);
    const status = req.body?.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';
    if (status === 'ACTIVE' && !s.merchant_id) throw conflict('景区尚未绑定商户，不能恢复接单');
    run('UPDATE scenes SET status = ? WHERE id = ?', status, s.id);
    audit(req.user.id, status === 'ACTIVE' ? 'SCENE_RESUME' : 'SCENE_PAUSE', `scene:${s.id}`);
    sendScene(res, s.id);
  }),
);

// 单项服务：启停与价格
r.put(
  '/scenes/:id/services/:type',
  h(async (req, res) => {
    const s = loadScene(req);
    const type = req.params.type;
    if (!SERVICES[type]) throw bad('服务类型不正确');
    const svc = one('SELECT * FROM scene_services WHERE scene_id = ? AND service_type = ?', s.id, type);
    if (!svc) throw notFound('服务不存在');
    const enabled = req.body?.enabled != null ? (req.body.enabled ? 1 : 0) : svc.enabled;
    let visitorPrice = svc.visitor_price;
    let merchantPrice = svc.merchant_price;
    if (req.body?.visitorPrice != null) {
      visitorPrice = parseYuan(req.body.visitorPrice);
      if (visitorPrice == null) throw bad('游客价格格式不正确');
    }
    if (req.body?.merchantPrice != null) {
      merchantPrice = parseYuan(req.body.merchantPrice);
      if (merchantPrice == null) throw bad('商户额度单价格式不正确');
    }
    run(
      'UPDATE scene_services SET enabled = ?, visitor_price = ?, merchant_price = ? WHERE scene_id = ? AND service_type = ?',
      enabled,
      visitorPrice,
      merchantPrice,
      s.id,
      type,
    );
    audit(req.user.id, 'SERVICE_UPDATE', `scene:${s.id}:${type}`, { enabled, visitorPrice, merchantPrice });
    sendScene(res, s.id);
  }),
);

// 管理员直接调整额度（写审计日志）
r.post(
  '/scenes/:id/quota',
  h(async (req, res) => {
    const s = loadScene(req);
    const type = req.body?.serviceType;
    if (!SERVICES[type]) throw bad('服务类型不正确');
    const delta = intIn(req.body?.delta, -100000, 100000);
    if (!delta) throw bad('调整次数须为非零整数');
    const note = str(req.body?.note, 100);
    tx(() => adjustQuota(s.id, type, delta, 'ADMIN', note || null, req.user.id));
    audit(req.user.id, 'QUOTA_ADJUST', `scene:${s.id}:${type}`, { delta, note });
    sendScene(res, s.id);
  }),
);

// 管理员修改景区现场服务设置（联系电话、服务时间、打印开关与取件地点）
r.put(
  '/scenes/:id/service',
  h(async (req, res) => {
    const s = loadScene(req);
    updateServiceSettings(s, req.body);
    audit(req.user.id, 'SERVICE_SETTINGS', `scene:${s.id}`, req.body);
    sendScene(res, s.id);
  }),
);

// 管理员为景区购买服务次数（模拟支付，记在景区商户名下）
r.post(
  '/scenes/:id/purchase',
  h(async (req, res) => {
    const s = loadScene(req);
    if (!s.merchant_id) throw conflict('景区尚未绑定商户');
    const p = createQuotaPurchase(s, s.merchant_id, req.body, { paid: true, actorId: req.user.id });
    audit(req.user.id, 'QUOTA_PURCHASE_PAID', p.purchase_no, { type: p.service_type, count: p.count, byAdmin: true });
    sendScene(res, s.id);
  }),
);

// 绑定商户：一景区一商户、一商户一景区
r.post(
  '/scenes/:id/bind',
  h(async (req, res) => {
    const s = loadScene(req);
    const userId = Number(req.body?.merchantUserId);
    tx(() => {
      const fresh = one('SELECT * FROM scenes WHERE id = ?', s.id);
      if (fresh.merchant_id) throw conflict('该景区已绑定商户，请先结清后解除绑定');
      const u = one('SELECT * FROM users WHERE id = ?', userId);
      if (!u) throw bad('用户不存在');
      if (!['merchant', 'admin'].includes(u.role)) throw bad('必须是商户或管理员账号');
      if (u.status !== 'ENABLED') throw bad('该账号已停用');
      const other = merchantScene(u.id);
      if (other) throw conflict(`该账号已绑定景区「${other.name}」`);
      run('UPDATE scenes SET merchant_id = ?, merchant_name = ? WHERE id = ?', u.id, u.merchant_name || u.nickname || u.username, s.id);
    });
    audit(req.user.id, 'SCENE_BIND', `scene:${s.id}`, { merchantUserId: userId });
    sendScene(res, s.id);
  }),
);

// 解除绑定：必须先结清收入、无进行中任务；解除后景区暂停
r.post(
  '/scenes/:id/unbind',
  h(async (req, res) => {
    const s = loadScene(req);
    if (!s.merchant_id) throw conflict('该景区尚未绑定商户');
    tx(() => {
      const w = merchantWallet(s.merchant_id);
      if (w.pendingCount > 0) throw conflict(`还有 ${w.pendingCount} 个制作中的订单，请完成后再解除`);
      if (w.frozen > 0) throw conflict('还有未处理的提现申请，请先审核或驳回');
      if (w.available > 0) throw conflict(`商户仍有 ${yuan(w.available)} 未提现收入，请结清后再解除`);
      run("UPDATE scenes SET merchant_id = NULL, status = 'PAUSED' WHERE id = ?", s.id);
      run("UPDATE orders SET status = 'CANCELLED', stage = '商户变更，订单取消' WHERE scene_id = ? AND status = 'PENDING'", s.id);
    });
    audit(req.user.id, 'SCENE_UNBIND', `scene:${s.id}`, { merchantUserId: s.merchant_id });
    sendScene(res, s.id);
  }),
);

r.get('/scenes/:id/template-usage', (req, res) => {
  res.json(templateUsage(loadScene(req).id, req.query.days));
});

r.get('/scenes/:id/quota-logs', (req, res) => {
  res.json(quotaLogPage(req, loadScene(req).id));
});

// ---------- 模板 ----------
r.get('/templates', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.sceneId) {
    where.push('t.scene_id = ?');
    params.push(Number(req.query.sceneId));
  }
  if (SERVICES[req.query.type]) {
    where.push('t.service_type = ?');
    params.push(req.query.type);
  }
  if (['ON', 'OFF', 'ARCHIVED'].includes(req.query.status)) {
    where.push('t.status = ?');
    params.push(req.query.status);
  } else {
    where.push("t.status != 'ARCHIVED'");
  }
  const q = str(req.query.q, 40);
  if (q) {
    where.push('t.title LIKE ?');
    params.push(`%${q}%`);
  }
  const rows = all(
    `SELECT t.*, s.name AS scene_name FROM templates t LEFT JOIN scenes s ON s.id = t.scene_id
     WHERE ${where.join(' AND ')} ORDER BY t.scene_id, t.service_type, t.featured DESC, t.sort DESC, t.id DESC`,
    ...params,
  );
  res.json(rows.map((t) => ({ ...templateView(t, null, { admin: true }), sceneName: t.scene_name })));
});

const templateUpload = upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'background', maxCount: 1 },
  { name: 'baseImage', maxCount: 1 },
  { name: 'sampleVideo', maxCount: 1 },
]);

async function applyTemplateFiles(req, current = {}) {
  const out = {};
  const opts = { scope: 'public', folder: 'templates', maxBytes: 12 * 1024 * 1024 };
  const [cover, background, baseImage, sampleVideo] = ['cover', 'background', 'baseImage', 'sampleVideo'].map((f) => firstFile(req, f));
  if (cover) out.cover = (await saveImage(cover, { ...opts, maxSide: 1600, label: '封面' })).key;
  if (background) {
    const bg = await saveImage(background, { ...opts, maxSide: 4096, label: '高清背景' });
    Object.assign(out, { background: bg.key, bg_width: bg.width, bg_height: bg.height });
  }
  if (baseImage) out.base_image = (await saveImage(baseImage, { ...opts, label: '白模场景图' })).key;
  if (sampleVideo) out.sample_video = await saveVideo(sampleVideo, { scope: 'public', folder: 'templates' });
  for (const k of ['cover', 'background', 'base_image', 'sample_video']) {
    // 背景可能被其他模板复用，仍被引用时不删除
    const shared = k === 'background' && current[k] && scalar('SELECT COUNT(*) FROM templates WHERE background = ? AND id != ?', current[k], current.id ?? 0) > 0;
    if (out[k] && current[k] && !shared) removeKey(current[k]).catch(() => {});
  }
  return out;
}

function templateFields(body, t = {}) {
  const f = {};
  if (body.title != null) f.title = str(body.title, 40);
  if (body.intro != null) f.intro = str(body.intro, 500);
  if (body.tags != null) f.tags = str(body.tags, 80);
  if (body.sort != null) f.sort = Number(body.sort) || 0;
  if (body.featured != null) f.featured = body.featured === true || body.featured === '1' || body.featured === 'true' ? 1 : 0;
  if (body.price != null) {
    if (body.price === '') f.price = null;
    else {
      f.price = parseYuan(body.price);
      if (f.price == null) throw bad('价格格式不正确，例如 1.90');
    }
  }
  for (const [k, col] of [
    ['anchorX', 'anchor_x'],
    ['anchorY', 'anchor_y'],
    ['personHeight', 'person_height'],
  ]) {
    if (body[k] != null) f[col] = body[k] === '' ? null : Math.max(0, Math.round(Number(body[k]) || 0));
  }
  if (body.status != null && ['ON', 'OFF'].includes(body.status)) f.status = body.status;
  if (body.videoPipeline != null) f.video_pipeline = body.videoPipeline === 'MULTI_SHOT' ? 'MULTI_SHOT' : 'LOOP';
  if (body.canvasWidth != null && body.canvasWidth !== '') f.bg_width = Math.max(1, Math.round(Number(body.canvasWidth) || 0));
  if (body.canvasHeight != null && body.canvasHeight !== '') f.bg_height = Math.max(1, Math.round(Number(body.canvasHeight) || 0));
  if (body.code != null && body.code !== '') {
    if (!/^[a-z0-9][a-z0-9\-]{1,60}$/.test(body.code)) throw bad('模板编码只能包含小写字母、数字和短横线');
    f.code = body.code;
  }
  // 归属商户：创建后固定，历史统计不随意转移
  if (body.ownerId != null && body.ownerId !== '' && t.owner_id == null) {
    const owner = one('SELECT id, role FROM users WHERE id = ?', Number(body.ownerId));
    if (!owner || !['merchant', 'admin'].includes(owner.role)) throw bad('归属账号必须是商户或管理员');
    f.owner_id = owner.id;
  }
  // 使用已有背景：从同景区另一模板复用高清背景
  if (body.backgroundFrom) {
    const src = one('SELECT background, bg_width, bg_height FROM templates WHERE id = ?', Number(body.backgroundFrom));
    if (!src?.background) throw bad('所选模板没有高清背景');
    Object.assign(f, { background: src.background, bg_width: src.bg_width, bg_height: src.bg_height });
  }
  return f;
}

function assertPublishable(t) {
  if (!t.title) throw bad('请填写模板名称');
  if (!t.cover) throw bad('请上传展示封面');
  if (t.service_type === 'CHECKIN' && !t.background) throw bad('打卡合拍模板需要上传高清背景后才能上架');
}

r.post(
  '/templates',
  templateUpload,
  h(async (req, res) => {
    const sceneId = Number(req.body?.sceneId);
    if (!one('SELECT 1 FROM scenes WHERE id = ?', sceneId)) throw bad('请选择景区');
    const type = req.body?.serviceType;
    if (!SERVICES[type]) throw bad('请选择业务类型');
    const fields = { status: 'OFF', ...templateFields(req.body || {}), ...(await applyTemplateFiles(req)) };
    if (!fields.title) throw bad('请填写模板名称');
    if (fields.status === 'ON') assertPublishable({ ...fields, service_type: type });
    const t = now();
    const cols = ['scene_id', 'service_type', 'created_by', 'created_at', 'updated_at', ...Object.keys(fields)];
    const vals = [sceneId, type, req.user.id, t, t, ...Object.values(fields)];
    const id = run(`INSERT INTO templates (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals).lastInsertRowid;
    audit(req.user.id, 'TEMPLATE_CREATE', `template:${id}`, { title: fields.title });
    res.json(templateView(one('SELECT * FROM templates WHERE id = ?', id), null, { admin: true }));
  }),
);

r.put(
  '/templates/:id',
  templateUpload,
  h(async (req, res) => {
    const t = one('SELECT * FROM templates WHERE id = ?', Number(req.params.id));
    if (!t) throw notFound('模板不存在');
    const fields = { ...templateFields(req.body || {}, t), ...(await applyTemplateFiles(req, t)) };
    const merged = { ...t, ...fields };
    if (merged.status === 'ON') assertPublishable(merged);
    if (Object.keys(fields).length) {
      fields.updated_at = now();
      run(`UPDATE templates SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(fields), t.id);
    }
    audit(req.user.id, 'TEMPLATE_UPDATE', `template:${t.id}`, Object.keys(fields).join(','));
    res.json(templateView(one('SELECT * FROM templates WHERE id = ?', t.id), null, { admin: true }));
  }),
);

// 上架 / 下架 / 归档 / 恢复
r.post(
  '/templates/:id/status',
  h(async (req, res) => {
    const t = one('SELECT * FROM templates WHERE id = ?', Number(req.params.id));
    if (!t) throw notFound('模板不存在');
    const status = req.body?.status;
    if (!['ON', 'OFF', 'ARCHIVED'].includes(status)) throw bad('状态不正确');
    if (status === 'ON') assertPublishable(t);
    run('UPDATE templates SET status = ?, updated_at = ? WHERE id = ?', status, now(), t.id);
    audit(req.user.id, 'TEMPLATE_STATUS', `template:${t.id}`, status);
    res.json(templateView(one('SELECT * FROM templates WHERE id = ?', t.id), null, { admin: true }));
  }),
);

// ---------- 账号与角色 ----------
r.get('/users', (req, res) => {
  const where = [];
  const params = [];
  if (ROLES.includes(req.query.role)) {
    where.push('role = ?');
    params.push(req.query.role);
  }
  const q = str(req.query.q, 40);
  if (q) {
    where.push('(username LIKE ? OR nickname LIKE ? OR CAST(id AS TEXT) = ?)');
    params.push(`%${q}%`, `%${q}%`, q);
  }
  res.json(
    paged(req, {
      from: 'users',
      where,
      params,
      map: (u) => {
        const scene = merchantScene(u.id);
        return {
          ...publicUser(u),
          scene: scene && { id: scene.id, name: scene.name },
          orders: scalar("SELECT COUNT(*) FROM orders WHERE user_id = ? AND status = 'SUCCESS'", u.id),
        };
      },
    }),
  );
});

r.post(
  '/users',
  h(async (req, res) => {
    const username = str(req.body?.username, 40);
    const password = String(req.body?.password ?? '');
    const role = ROLES.includes(req.body?.role) ? req.body.role : 'visitor';
    if (!USERNAME_RE.test(username) || !PASSWORD_RE.test(password)) {
      throw bad('账号须为2–20位字母、数字或下划线；密码须为8–20位并包含字母和数字');
    }
    const passwordHash = await hashPassword(password);
    if (one('SELECT 1 FROM users WHERE username = ?', username)) throw conflict('账号已存在');
    const id = run(
      "INSERT INTO users (username, password_hash, nickname, role, status, created_at) VALUES (?, ?, ?, ?, 'ENABLED', ?)",
      username,
      passwordHash,
      str(req.body?.nickname, 20) || username,
      role,
      now(),
    ).lastInsertRowid;
    audit(req.user.id, 'USER_CREATE', `user:${id}`, { username, role });
    res.json(publicUser(one('SELECT * FROM users WHERE id = ?', id)));
  }),
);

r.put(
  '/users/:id',
  h(async (req, res) => {
    const u = one('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!u) throw notFound('用户不存在');
    const role = req.body?.role != null ? req.body.role : u.role;
    const status = req.body?.status != null ? req.body.status : u.status;
    if (!ROLES.includes(role)) throw bad('角色不正确');
    if (!['ENABLED', 'DISABLED'].includes(status)) throw bad('状态不正确');
    if (u.id === req.user.id && (role !== 'admin' || status !== 'ENABLED')) throw conflict('不能降低或停用当前登录的管理员账号');
    const scene = merchantScene(u.id);
    if (scene && role === 'visitor') throw conflict(`该账号绑定了景区「${scene.name}」，请先解除绑定再改为游客`);
    if (scene && status === 'DISABLED') throw conflict(`该账号绑定了景区「${scene.name}」，请先解除绑定再停用`);
    const nickname = req.body?.nickname != null ? str(req.body.nickname, 20) || u.username : u.nickname;
    const merchantName = req.body?.merchantName != null ? str(req.body.merchantName, 40) : u.merchant_name;
    let passwordHash = u.password_hash;
    if (req.body?.password) {
      if (!PASSWORD_RE.test(req.body.password)) throw bad('密码须为8–20位并包含字母和数字');
      passwordHash = await hashPassword(req.body.password);
    }
    run(
      'UPDATE users SET role = ?, status = ?, nickname = ?, merchant_name = ?, password_hash = ? WHERE id = ?',
      role,
      status,
      nickname,
      merchantName,
      passwordHash,
      u.id,
    );
    if (status === 'DISABLED' || role !== u.role || passwordHash !== u.password_hash) destroyUserSessions(u.id);
    audit(req.user.id, 'USER_UPDATE', `user:${u.id}`, { role, status, passwordReset: passwordHash !== u.password_hash });
    res.json(publicUser(one('SELECT * FROM users WHERE id = ?', u.id)));
  }),
);

// ---------- 流水 ----------
r.get('/orders', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.sceneId) {
    where.push('scene_id = ?');
    params.push(Number(req.query.sceneId));
  }
  if (['PENDING', 'QUEUED', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'].includes(req.query.status)) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  if (SERVICES[req.query.type]) {
    where.push('service_type = ?');
    params.push(req.query.type);
  }
  const q = str(req.query.q, 40);
  if (q) {
    where.push('(order_no LIKE ? OR user_id IN (SELECT id FROM users WHERE username LIKE ?))');
    params.push(`%${q}%`, `%${q}%`);
  }
  res.json(paged(req, { from: 'orders', where, params, map: (o) => orderView(o, { audience: 'admin' }) }));
});

r.get('/purchases', (req, res) => {
  const sceneId = req.query.sceneId ? Number(req.query.sceneId) : null;
  res.json(
    paged(req, {
      from: 'quota_purchases',
      where: sceneId ? ['scene_id = ?'] : [],
      params: sceneId ? [sceneId] : [],
      map: (x) => ({ ...purchaseView(x), merchant: userBrief(x.merchant_id) }),
    }),
  );
});

// ---------- 提现审核 ----------
r.get('/withdrawals', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.sceneId) {
    where.push('scene_id = ?');
    params.push(Number(req.query.sceneId));
  }
  if (req.query.status === 'open') where.push("status IN ('REQUESTED','APPROVED')");
  else if (['REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'].includes(req.query.status)) {
    where.push('status = ?');
    params.push(req.query.status);
  }
  const wallets = new Map();
  const walletOf = (id) => wallets.get(id) ?? wallets.set(id, merchantWallet(id)).get(id);
  res.json(
    paged(req, {
      from: 'withdrawals',
      where,
      params,
      order: "CASE status WHEN 'REQUESTED' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, id DESC",
      map: (x) => ({ ...withdrawalView(x), wallet: walletOf(x.merchant_id) }),
    }),
  );
});

function transition(action, from, to, needNote = false) {
  return h(async (req, res) => {
    const w = one('SELECT * FROM withdrawals WHERE id = ?', Number(req.params.id));
    if (!w) throw notFound('提现申请不存在');
    const note = str(req.body?.note, 200);
    if (needNote && !note) throw bad('请先填写驳回原因');
    const t = now();
    const extra = to === 'PAID' ? ', paid_at = ?' : ', reviewed_at = ?, reviewer_id = ?';
    const extraParams = to === 'PAID' ? [t] : [t, req.user.id];
    const changed = run(
      `UPDATE withdrawals SET status = ?, review_note = CASE WHEN ? = '' THEN review_note ELSE ? END${extra} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`,
      to,
      note,
      note,
      ...extraParams,
      w.id,
      ...from,
    ).changes;
    if (!changed) throw conflict('申请状态已变化，请刷新');
    audit(req.user.id, action, `withdrawal:${w.id}`, { amount: w.amount, note });
    res.json(withdrawalView(one('SELECT * FROM withdrawals WHERE id = ?', w.id)));
  });
}
r.post('/withdrawals/:id/approve', transition('WITHDRAW_APPROVE', ['REQUESTED'], 'APPROVED'));
r.post('/withdrawals/:id/reject', transition('WITHDRAW_REJECT', ['REQUESTED', 'APPROVED'], 'REJECTED', true));
r.post('/withdrawals/:id/pay', transition('WITHDRAW_PAY', ['APPROVED'], 'PAID'));

// ---------- 标准成本与运行设置 ----------
r.get('/settings', (req, res) => {
  res.json({
    costs: Object.fromEntries(SERVICE_TYPES.map((t) => [t, standardCost(t)])),
    mockFailRate: Number(getSetting('mock.fail_rate', '0')),
    captchaEnabled: getSetting('captcha.enabled', '0') === '1',
  });
});

r.put(
  '/settings',
  h(async (req, res) => {
    const costs = req.body?.costs || {};
    for (const type of SERVICE_TYPES) {
      if (costs[type] == null) continue;
      const cents = parseYuan(costs[type]);
      if (cents == null) throw bad(`${SERVICES[type].name}标准成本格式不正确`);
      setSetting(`cost.${type}`, cents);
    }
    if (req.body?.mockFailRate != null) {
      const rate = intIn(req.body.mockFailRate, 0, 100);
      if (rate == null) throw bad('模拟失败率须为 0–100 的整数');
      setSetting('mock.fail_rate', rate);
    }
    if (req.body?.captchaEnabled != null) setSetting('captcha.enabled', req.body.captchaEnabled ? '1' : '0');
    audit(req.user.id, 'SETTINGS_UPDATE', 'settings', req.body);
    res.json({ ok: true });
  }),
);

r.get('/audit', (req, res) => {
  res.json(paged(req, { from: 'audit_logs a LEFT JOIN users u ON u.id = a.actor_id', select: 'a.*, u.username', order: 'a.id DESC', size: 30 }));
});

export default r;
