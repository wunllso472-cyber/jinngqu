import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from './config.js';
import { bad } from './util.js';

/**
 * 文件以 key 标识，形如 public/templates/202609/xxxx.jpg 或 private/characters/...
 * public 目录直接访问；private 目录需要带有效期的签名链接。
 */
const KEY_RE = /^(public|private)\/[a-z0-9_\-]+\/\d{6}\/[a-zA-Z0-9_\-]+\.[a-z0-9]{2,5}$/;

export function isValidKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

export function absPath(key) {
  if (!isValidKey(key)) throw bad('无效的文件路径');
  return path.join(config.uploadDir, ...key.split('/'));
}

function newKey(scope, folder, ext) {
  const d = new Date();
  const month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${scope}/${folder}/${month}/${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
}

export async function saveBuffer(buffer, { scope, folder, ext }) {
  const key = newKey(scope, folder, ext);
  const file = absPath(key);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buffer);
  return key;
}

export async function copyFileIn(src, { scope, folder, ext }) {
  const key = newKey(scope, folder, ext);
  const file = absPath(key);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.copyFile(src, file);
  return key;
}

export async function removeKey(key) {
  if (!isValidKey(key)) return;
  await fs.promises.rm(absPath(key), { force: true });
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);

/**
 * 校验并规范化上传的图片：自动旋转、限制最长边，输出 JPEG（带透明通道则输出 PNG）。
 */
export async function saveImage(file, { scope, folder, maxBytes = 10 * 1024 * 1024, maxSide = 2560, label = '图片' }) {
  if (!file) throw bad(`请上传${label}`);
  if (!IMAGE_MIME.has(file.mimetype)) throw bad(`${label}仅支持 JPG、JPEG、PNG`);
  if (file.size > maxBytes) throw bad(`${label}不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);
  let meta;
  try {
    meta = await sharp(file.buffer).metadata();
  } catch {
    throw bad(`${label}无法识别，请重新选择`);
  }
  if (!meta.width || !meta.height) throw bad(`${label}无法识别，请重新选择`);
  if (meta.width * meta.height > 20_000_000) throw bad(`${label}像素过大（上限 2000 万像素）`);
  const pipeline = sharp(file.buffer).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  const png = meta.hasAlpha && meta.format === 'png';
  const out = png ? await pipeline.png().toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const key = await saveBuffer(out.data, { scope, folder, ext: png ? 'png' : 'jpg' });
  return { key, width: out.info.width, height: out.info.height };
}

export async function saveVideo(file, { scope, folder, maxBytes = 120 * 1024 * 1024 }) {
  if (!file) throw bad('请上传视频');
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.mimetype)) throw bad('视频仅支持 MP4 / MOV / WEBM');
  if (file.size > maxBytes) throw bad('视频不能超过 120MB');
  const ext = file.mimetype === 'video/webm' ? 'webm' : file.mimetype === 'video/quicktime' ? 'mov' : 'mp4';
  return saveBuffer(file.buffer, { scope, folder, ext });
}

function sign(key, exp) {
  return crypto.createHmac('sha256', config.secret).update(`${key}:${exp}`).digest('base64url').slice(0, 32);
}

/** 生成可访问的 URL；private 文件附带至少 2 小时有效期签名（到期时间按小时取整，便于浏览器缓存） */
export function fileUrl(key, ttlSec = 7200) {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key;
  if (!isValidKey(key)) return null;
  if (key.startsWith('public/')) return `/files/${key}`;
  const exp = Math.ceil((Date.now() / 1000 + ttlSec) / 3600) * 3600;
  return `/files/${key}?e=${exp}&s=${sign(key, exp)}`;
}

export function verifySignature(key, exp, s) {
  if (!key.startsWith('private/')) return true;
  const e = Number(exp);
  if (!e || e < Date.now() / 1000 || typeof s !== 'string') return false;
  const expected = sign(key, e);
  return s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected));
}
