export const yuan = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
export const yuanPlain = (cents) => (Number(cents || 0) / 100).toFixed(2);

export const SERVICE_META = {
  CHECKIN: { name: '打卡合拍', short: '合拍', desc: '人物走进景区高清背景，生成同款打卡合照', icon: '📍' },
  OUTFIT_PHOTO: { name: 'AI换装照片', short: '照片', desc: '白模场景 + 人物模板，AI 生成换装写真', icon: '🖼️' },
  OUTFIT_VIDEO: { name: 'AI换装视频', short: '视频', desc: '跟随固定动作，生成多景点竖版短视频', icon: '🎬' },
};
export const SERVICE_TYPES = Object.keys(SERVICE_META);

export const ORDER_STATUS = {
  PENDING: { text: '待支付', tone: 'warn' },
  QUEUED: { text: '模拟已支付 · 排队中', tone: 'info' },
  PROCESSING: { text: '制作中', tone: 'info' },
  SUCCESS: { text: '已完成', tone: 'ok' },
  FAILED: { text: '制作失败 · 已模拟退款', tone: 'bad' },
  CANCELLED: { text: '已取消', tone: 'mute' },
};

export const WITHDRAW_STATUS = {
  REQUESTED: { text: '待管理员审核', tone: 'warn' },
  APPROVED: { text: '已审核 · 待模拟打款', tone: 'info' },
  PAID: { text: '已模拟打款', tone: 'ok' },
  REJECTED: { text: '已驳回 · 金额已释放', tone: 'bad' },
  CANCELLED: { text: '已撤销 · 金额已释放', tone: 'mute' },
};

export const PURCHASE_STATUS = {
  PENDING: { text: '待支付', tone: 'warn' },
  PAID: { text: '模拟支付成功', tone: 'ok' },
  CANCELLED: { text: '已取消', tone: 'mute' },
};

export const TICKET_STATUS = {
  PENDING: { text: '待处理', tone: 'warn' },
  REPLIED: { text: '客服已回复', tone: 'ok' },
  CLOSED: { text: '已关闭', tone: 'mute' },
};

export const PRINT_STATUS = {
  PENDING: { text: '待商户处理', tone: 'warn' },
  READY: { text: '可取件', tone: 'ok' },
  PICKED: { text: '已取件', tone: 'mute' },
  CANCELLED: { text: '已取消', tone: 'mute' },
};

export const CODE_STATUS = {
  ACTIVE: { text: '可兑换', tone: 'ok' },
  REDEEMED: { text: '已兑换', tone: 'info' },
  REVOKED: { text: '已撤销', tone: 'mute' },
  EXPIRED: { text: '已过期', tone: 'bad' },
};

export const TEMPLATE_STATUS = {
  ON: { text: '已上架', tone: 'ok' },
  OFF: { text: '已下架', tone: 'mute' },
  ARCHIVED: { text: '已归档', tone: 'bad' },
};

export const ROLE_NAMES = { visitor: '游客', merchant: '商户', admin: '管理员' };

export const QUOTA_REASON = { PURCHASE: '购买', CONSUME: '制作扣除', REFUND: '失败回补', ADMIN: '管理员调整' };

export const shortTime = (s) => (s ? s.slice(5, 16) : '');
