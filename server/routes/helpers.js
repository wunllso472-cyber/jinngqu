import multer from 'multer';
import { one } from '../db.js';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024, files: 6 },
});

export const firstFile = (req, field) => req.files?.[field]?.[0] || null;

/** 商户（或管理员）当前绑定的景区 */
export function merchantScene(userId) {
  return one('SELECT * FROM scenes WHERE merchant_id = ?', userId);
}
