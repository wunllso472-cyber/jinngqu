// 领域逻辑：景区服务可用性、订单序列化、商户钱包、额度变动、退款
import { all, getSetting, one, run, tx } from './db.js';
import { SERVICES, SERVICE_TYPES, LOW_QUOTA } from './constants.js';
import { fileUrl } from './storage.js';
import { bad, conflict, dateOnly, intIn, now, paged, serialNo, str } from './util.js';

export const userBrief = (id) => one('SELECT id, username, nickname FROM users WHERE id = ?', id);

export function standardCost(type) {
  const v = getSetting(`cost.${type}`);
  return v == null ? SERVICES[type].standardCost : Number(v);
}

/** 新景区：为每种服务写入默认配置 */
export function initSceneServices(sceneId) {
  for (const type of SERVICE_TYPES) {
    run(
      'INSERT INTO scene_services (scene_id, service_type, enabled, quota, visitor_price, merchant_price) VALUES (?, ?, 1, 0, ?, ?)',
      sceneId,
      type,
      SERVICES[type].visitorPrice,
      SERVICES[type].merchantPrice,
    );
  }
}

export function sceneServices(sceneId) {
  const rows = all('SELECT * FROM scene_services WHERE scene_id = ?', sceneId);
  const map = Object.fromEntries(rows.map((r) => [r.service_type, r]));
  return SERVICE_TYPES.map((type) => {
    const r = map[type] || { enabled: 0, quota: 0, visitor_price: SERVICES[type].visitorPrice, merchant_price: SERVICES[type].merchantPrice };
    return {
      type,
      name: SERVICES[type].name,
      standardCost: standardCost(type),
      enabled: !!r.enabled,
      quota: r.quota,
      visitorPrice: r.visitor_price,
      merchantPrice: r.merchant_price,
      lowQuota: r.quota > 0 && r.quota < LOW_QUOTA,
    };
  });
}

/** 服务能否接单；返回 { ok, reason } */
export function serviceAvailability(scene, service) {
  if (!scene) return { ok: false, reason: '景区不存在' };
  if (scene.status !== 'ACTIVE') return { ok: false, reason: '景区服务已暂停' };
  if (!scene.merchant_id) return { ok: false, reason: '景区尚未绑定商户，暂停接单' };
  if (!service || !service.enabled) return { ok: false, reason: '该服务已停用' };
  if (service.quota <= 0) return { ok: false, reason: '该景区此项服务额度已用完，请联系景区商户' };
  return { ok: true, reason: '' };
}

export function sceneView(scene, { withMerchant = false } = {}) {
  const services = sceneServices(scene.id).map((s) => {
    const a = serviceAvailability(scene, s);
    return { ...s, available: a.ok, reason: a.reason };
  });
  const view = {
    id: scene.id,
    name: scene.name,
    subtitle: scene.subtitle,
    city: scene.city,
    intro: scene.intro,
    cover: fileUrl(scene.cover),
    status: scene.status,
    bound: !!scene.merchant_id,
    merchantName: scene.merchant_name,
    servicePhone: scene.service_phone,
    serviceHours: scene.service_hours,
    printEnabled: !!scene.print_enabled,
    pickupAddress: scene.pickup_address,
    services,
  };
  if (withMerchant) {
    view.merchant = scene.merchant_id ? userBrief(scene.merchant_id) : null;
    view.sort = scene.sort;
  }
  return view;
}

/** 现场服务设置（联系电话、服务时间、打印开关与取件地点），商户与管理员共用 */
export function updateServiceSettings(scene, body = {}) {
  const printEnabled = body.printEnabled != null ? (body.printEnabled ? 1 : 0) : scene.print_enabled;
  const pickupAddress = str(body.pickupAddress ?? scene.pickup_address, 300);
  if (printEnabled && !pickupAddress) throw bad('开放打印申请时必须填写取件地点');
  run(
    'UPDATE scenes SET merchant_name = ?, service_phone = ?, service_hours = ?, print_enabled = ?, pickup_address = ? WHERE id = ?',
    str(body.merchantName ?? scene.merchant_name, 40),
    str(body.servicePhone ?? scene.service_phone, 30),
    str(body.serviceHours ?? scene.service_hours, 40),
    printEnabled,
    pickupAddress,
    scene.id,
  );
}

/** 创建额度购买单；paid 时直接模拟支付并入账（管理员代购） */
export function createQuotaPurchase(scene, merchantId, body, { paid = false, actorId = null } = {}) {
  const type = body?.serviceType;
  if (!SERVICES[type]) throw bad('请选择服务类型');
  const count = intIn(body?.count, 1, 10000);
  if (!count) throw bad('购买次数须为 1–10000 的整数');
  const svc = one('SELECT * FROM scene_services WHERE scene_id = ? AND service_type = ?', scene.id, type);
  if (!svc) throw bad('景区未开通该服务');
  const no = serialNo('QP');
  return tx(() => {
    const t = now();
    const id = run(
      'INSERT INTO quota_purchases (purchase_no, scene_id, merchant_id, service_type, count, unit_price, amount, status, created_at, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      no,
      scene.id,
      merchantId,
      type,
      count,
      svc.merchant_price,
      svc.merchant_price * count,
      paid ? 'PAID' : 'PENDING',
      t,
      paid ? t : null,
    ).lastInsertRowid;
    if (paid) adjustQuota(scene.id, type, count, 'PURCHASE', no, actorId);
    return one('SELECT * FROM quota_purchases WHERE id = ?', id);
  });
}

export const quotaLogPage = (req, sceneId) =>
  paged(req, { from: 'quota_logs', where: ['scene_id = ?'], params: [sceneId], map: (l) => ({ ...l, serviceName: SERVICES[l.service_type]?.name }) });

export function templatePrice(template, sceneId) {
  if (template.price != null) return template.price;
  const s = one('SELECT visitor_price FROM scene_services WHERE scene_id = ? AND service_type = ?', sceneId, template.service_type);
  return s ? s.visitor_price : SERVICES[template.service_type].visitorPrice;
}

/** 模板的点赞 / 收藏 / 使用数，以及当前用户是否已点赞、收藏（一次查询） */
export function templateStats(templateId, userId = null) {
  const s = one(
    `SELECT (SELECT COUNT(*) FROM likes WHERE template_id = ?1) AS likes,
            (SELECT COUNT(*) FROM favorites WHERE template_id = ?1) AS favorites,
            (SELECT COUNT(*) FROM orders WHERE template_id = ?1 AND status = 'SUCCESS') AS uses,
            EXISTS (SELECT 1 FROM likes WHERE template_id = ?1 AND user_id = ?2) AS liked,
            EXISTS (SELECT 1 FROM favorites WHERE template_id = ?1 AND user_id = ?2) AS favorited`,
    templateId,
    userId,
  );
  return { ...s, liked: !!s.liked, favorited: !!s.favorited };
}

export function templateView(t, userId = null, { admin = false } = {}) {
  const { likes, favorites, uses, liked, favorited } = templateStats(t.id, userId);
  const view = {
    id: t.id,
    sceneId: t.scene_id,
    serviceType: t.service_type,
    serviceName: SERVICES[t.service_type]?.name,
    title: t.title,
    intro: t.intro,
    tags: t.tags ? t.tags.split(/[·,，\s]+/).filter(Boolean) : [],
    cover: fileUrl(t.cover),
    background: fileUrl(t.background),
    baseImage: fileUrl(t.base_image),
    sampleVideo: fileUrl(t.sample_video),
    hasBaseImage: !!t.base_image,
    price: templatePrice(t, t.scene_id),
    code: t.code,
    videoPipeline: t.video_pipeline,
    featured: !!t.featured,
    status: t.status,
    likes,
    favorites,
    uses,
    liked,
    favorited,
  };
  if (admin) {
    Object.assign(view, {
      tagsRaw: t.tags,
      customPrice: t.price,
      sort: t.sort,
      anchorX: t.anchor_x,
      anchorY: t.anchor_y,
      personHeight: t.person_height,
      bgWidth: t.bg_width,
      bgHeight: t.bg_height,
      ownerId: t.owner_id,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    });
  }
  return view;
}

/**
 * 订单序列化。audience：owner 游客本人；merchant 商户（不含作品原图与人物）；admin 管理员
 */
export function orderView(o, { audience = 'owner' } = {}) {
  const t = one('SELECT id, title, cover FROM templates WHERE id = ?', o.template_id);
  const s = one('SELECT id, name FROM scenes WHERE id = ?', o.scene_id);
  const view = {
    id: o.id,
    orderNo: o.order_no,
    serviceType: o.service_type,
    serviceName: SERVICES[o.service_type]?.name,
    sceneId: o.scene_id,
    sceneName: s?.name,
    templateId: o.template_id,
    templateTitle: t?.title,
    templateCover: fileUrl(t?.cover),
    amount: o.amount,
    refundAmount: o.refund_amount,
    status: o.status,
    progress: o.progress,
    stage: o.stage,
    error: o.error,
    resultKind: o.result_kind,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    finishedAt: o.finished_at,
    refundedAt: o.refunded_at,
  };
  if (audience !== 'merchant') {
    const c = o.character_id ? one('SELECT id, name, body_image FROM characters WHERE id = ?', o.character_id) : null;
    view.character = c ? { id: c.id, name: c.name, image: fileUrl(c.body_image) } : null;
    view.resultUrl = o.status === 'SUCCESS' ? fileUrl(o.result_key) : null;
  }
  if (audience !== 'owner') {
    view.user = userBrief(o.user_id);
    view.merchantId = o.merchant_id;
    view.unitCost = o.unit_cost;
  }
  if (audience === 'admin') view.provider = o.provider;
  return view;
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

export const withdrawalView = (w) => ({
  id: w.id,
  withdrawalNo: w.withdrawal_no,
  merchant: userBrief(w.merchant_id),
  scene: w.scene_id ? one('SELECT id, name FROM scenes WHERE id = ?', w.scene_id) : null,
  amount: w.amount,
  note: w.note,
  status: w.status,
  reviewNote: w.review_note,
  createdAt: w.created_at,
  reviewedAt: w.reviewed_at,
  paidAt: w.paid_at,
});

/** 商户钱包（全部为模拟金额，单位分） */
export function merchantWallet(merchantId) {
  const o = one(
    `SELECT COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN status IN ('QUEUED','PROCESSING') THEN amount END), 0) AS pending,
            COALESCE(SUM(CASE WHEN status = 'FAILED' THEN refund_amount END), 0) AS refunded,
            COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) AS successCount,
            COUNT(CASE WHEN status IN ('QUEUED','PROCESSING') THEN 1 END) AS pendingCount,
            COUNT(CASE WHEN status = 'FAILED' THEN 1 END) AS refundedCount
     FROM orders WHERE merchant_id = ?`,
    merchantId,
  );
  const w = one(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('REQUESTED','APPROVED') THEN amount END), 0) AS frozen,
            COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount END), 0) AS withdrawn
     FROM withdrawals WHERE merchant_id = ?`,
    merchantId,
  );
  const quotaSpend = one("SELECT COALESCE(SUM(amount), 0) AS v FROM quota_purchases WHERE merchant_id = ? AND status = 'PAID'", merchantId).v;
  return {
    income: o.income,
    pending: o.pending,
    pendingCount: o.pendingCount,
    refunded: o.refunded,
    refundedCount: o.refundedCount,
    frozen: w.frozen,
    withdrawn: w.withdrawn,
    available: o.income - w.frozen - w.withdrawn,
    quotaSpend,
    successCount: o.successCount,
  };
}

/** 调整额度并写流水（在事务内调用） */
export function adjustQuota(sceneId, type, delta, reason, ref, actorId = null) {
  const svc = one('SELECT quota FROM scene_services WHERE scene_id = ? AND service_type = ?', sceneId, type);
  if (!svc) throw bad('景区未配置该服务');
  const balance = svc.quota + delta;
  if (balance < 0) throw conflict('该景区此项服务额度已用完，请联系景区商户', 'QUOTA_EMPTY');
  run('UPDATE scene_services SET quota = ? WHERE scene_id = ? AND service_type = ?', balance, sceneId, type);
  run(
    'INSERT INTO quota_logs (scene_id, service_type, delta, balance, reason, ref, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    sceneId,
    type,
    delta,
    balance,
    reason,
    ref ?? null,
    actorId,
    now(),
  );
  return balance;
}

/** 制作失败：标记失败、模拟退款并回补次数 */
export function failAndRefund(orderId, message) {
  return tx(() => {
    const o = one('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o || !['QUEUED', 'PROCESSING'].includes(o.status)) return false;
    const t = now();
    run(
      `UPDATE orders SET status = 'FAILED', error = ?, stage = '制作失败 · 已模拟退款', refund_amount = amount,
       refunded_at = ?, finished_at = ? WHERE id = ?`,
      String(message || '制作失败').slice(0, 300),
      t,
      t,
      o.id,
    );
    adjustQuota(o.scene_id, o.service_type, +1, 'REFUND', o.order_no);
    return true;
  });
}

// ---------- 模板使用情况 ----------
const USAGE_DAYS = [0, 7, 30, 90];

/** days 取 0 / 7 / 30 / 90（0 为全部），其他值按 30 天 */
export function templateUsage(sceneId, daysInput, merchantId = null) {
  const days = USAGE_DAYS.includes(Number(daysInput)) ? Number(daysInput) : 30;
  const since = days > 0 ? dateOnly(new Date(Date.now() - (days - 1) * 86400_000)) : '0000-00-00';
  const mFilter = merchantId ? ' AND o.merchant_id = ?' : '';
  const mParams = merchantId ? [merchantId] : [];
  const rows = all(
    `SELECT t.id, t.title, t.service_type, t.cover, t.status,
       COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 END), 0) AS success,
       COALESCE(SUM(CASE WHEN o.status = 'FAILED' THEN 1 END), 0) AS failed,
       COALESCE(SUM(CASE WHEN o.status IN ('QUEUED','PROCESSING') THEN 1 END), 0) AS processing,
       COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount END), 0) AS revenue,
       COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.unit_cost END), 0) AS cost,
       (SELECT COUNT(*) FROM likes l WHERE l.template_id = t.id) AS likes,
       (SELECT COUNT(*) FROM favorites f WHERE f.template_id = t.id) AS favorites
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
    likes: t.likes,
    favorites: t.favorites,
  }));
  const totals = templates.reduce(
    (acc, t) => ({ success: acc.success + t.success, failed: acc.failed + t.failed, revenue: acc.revenue + t.revenue, cost: acc.cost + t.cost }),
    { success: 0, failed: 0, revenue: 0, cost: 0 },
  );
  return { since: days > 0 ? since : null, templates, trend, totals };
}
