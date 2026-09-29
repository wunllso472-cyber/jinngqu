// 领域逻辑：景区服务可用性、订单序列化、商户钱包、额度变动、退款
import { all, getSetting, one, run, scalar, tx } from './db.js';
import { SERVICES, SERVICE_TYPES, LOW_QUOTA } from './constants.js';
import { fileUrl } from './storage.js';
import { bad, conflict, now } from './util.js';

export function standardCost(type) {
  const v = getSetting(`cost.${type}`);
  return v == null ? SERVICES[type].standardCost : Number(v);
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
    const m = scene.merchant_id ? one('SELECT id, username, nickname FROM users WHERE id = ?', scene.merchant_id) : null;
    view.merchant = m ? { id: m.id, username: m.username, nickname: m.nickname } : null;
    view.sort = scene.sort;
  }
  return view;
}

export function templatePrice(template, sceneId) {
  if (template.price != null) return template.price;
  const s = one('SELECT visitor_price FROM scene_services WHERE scene_id = ? AND service_type = ?', sceneId, template.service_type);
  return s ? s.visitor_price : SERVICES[template.service_type].visitorPrice;
}

export function templateView(t, userId = null, { admin = false } = {}) {
  const likes = scalar('SELECT COUNT(*) FROM likes WHERE template_id = ?', t.id);
  const favorites = scalar('SELECT COUNT(*) FROM favorites WHERE template_id = ?', t.id);
  const uses = scalar("SELECT COUNT(*) FROM orders WHERE template_id = ? AND status = 'SUCCESS'", t.id);
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
    liked: userId ? !!one('SELECT 1 FROM likes WHERE user_id = ? AND template_id = ?', userId, t.id) : false,
    favorited: userId ? !!one('SELECT 1 FROM favorites WHERE user_id = ? AND template_id = ?', userId, t.id) : false,
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

export function orderView(o, { withUser = false } = {}) {
  const t = one('SELECT id, title, cover FROM templates WHERE id = ?', o.template_id);
  const s = one('SELECT id, name FROM scenes WHERE id = ?', o.scene_id);
  const c = o.character_id ? one('SELECT id, name, body_image FROM characters WHERE id = ?', o.character_id) : null;
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
    character: c ? { id: c.id, name: c.name, image: fileUrl(c.body_image) } : null,
    amount: o.amount,
    refundAmount: o.refund_amount,
    status: o.status,
    progress: o.progress,
    stage: o.stage,
    error: o.error,
    resultUrl: o.status === 'SUCCESS' ? fileUrl(o.result_key) : null,
    resultKind: o.result_kind,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    finishedAt: o.finished_at,
    refundedAt: o.refunded_at,
  };
  if (withUser) {
    const u = one('SELECT id, username, nickname FROM users WHERE id = ?', o.user_id);
    view.user = u ? { id: u.id, username: u.username, nickname: u.nickname } : null;
    view.merchantId = o.merchant_id;
    view.unitCost = o.unit_cost;
    view.provider = o.provider;
  }
  return view;
}

/** 商户钱包（全部为模拟金额，单位分） */
export function merchantWallet(merchantId) {
  const sum = (sql, ...p) => Number(scalar(sql, ...p) || 0);
  const income = sum("SELECT SUM(amount) FROM orders WHERE merchant_id = ? AND status = 'SUCCESS'", merchantId);
  const pending = sum("SELECT SUM(amount) FROM orders WHERE merchant_id = ? AND status IN ('QUEUED','PROCESSING')", merchantId);
  const refunded = sum("SELECT SUM(refund_amount) FROM orders WHERE merchant_id = ? AND status = 'FAILED'", merchantId);
  const frozen = sum("SELECT SUM(amount) FROM withdrawals WHERE merchant_id = ? AND status IN ('REQUESTED','APPROVED')", merchantId);
  const withdrawn = sum("SELECT SUM(amount) FROM withdrawals WHERE merchant_id = ? AND status = 'PAID'", merchantId);
  const quotaSpend = sum("SELECT SUM(amount) FROM quota_purchases WHERE merchant_id = ? AND status = 'PAID'", merchantId);
  const successCount = sum("SELECT COUNT(*) FROM orders WHERE merchant_id = ? AND status = 'SUCCESS'", merchantId);
  const pendingCount = sum("SELECT COUNT(*) FROM orders WHERE merchant_id = ? AND status IN ('QUEUED','PROCESSING')", merchantId);
  const refundedCount = sum("SELECT COUNT(*) FROM orders WHERE merchant_id = ? AND status = 'FAILED'", merchantId);
  return {
    income,
    pending,
    pendingCount,
    refunded,
    refundedCount,
    frozen,
    withdrawn,
    available: income - frozen - withdrawn,
    quotaSpend,
    successCount,
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
