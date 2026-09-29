// 三种服务：游客按次价格、商户额度单价、平台标准成本（单位：分）
export const SERVICES = {
  CHECKIN: { name: '打卡合拍', short: '合拍', visitorPrice: 90, merchantPrice: 0, standardCost: 0 },
  OUTFIT_PHOTO: { name: 'AI换装照片', short: '照片', visitorPrice: 190, merchantPrice: 30, standardCost: 25 },
  OUTFIT_VIDEO: { name: 'AI换装视频', short: '视频', visitorPrice: 990, merchantPrice: 200, standardCost: 120 },
};
export const SERVICE_TYPES = Object.keys(SERVICES);

export const ROLES = ['visitor', 'merchant', 'admin'];
export const ROLE_NAMES = { visitor: '游客', merchant: '商户', admin: '管理员' };

export const ORDER_ACTIVE = ['QUEUED', 'PROCESSING'];
export const LOW_QUOTA = 5;
