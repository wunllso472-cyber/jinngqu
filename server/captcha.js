// 图形验证码（管理员可在设置中开启）：SVG 渲染，答案仅保存在内存中，2 分钟有效、一次性
import crypto from 'node:crypto';
import { getSetting } from './db.js';
import { bad } from './util.js';

const store = new Map();
const TTL = 2 * 60 * 1000;
const CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const captchaEnabled = () => getSetting('captcha.enabled', '0') === '1';

function svgFor(text) {
  const w = 120;
  const h = 44;
  const rnd = (a, b) => a + Math.random() * (b - a);
  let lines = '';
  for (let i = 0; i < 5; i++) {
    lines += `<line x1="${rnd(0, w)}" y1="${rnd(0, h)}" x2="${rnd(0, w)}" y2="${rnd(0, h)}" stroke="hsl(${rnd(0, 360)},60%,60%)" stroke-width="${rnd(1, 2)}"/>`;
  }
  let dots = '';
  for (let i = 0; i < 25; i++) dots += `<circle cx="${rnd(0, w)}" cy="${rnd(0, h)}" r="1" fill="hsl(${rnd(0, 360)},50%,70%)"/>`;
  const chars = [...text]
    .map((ch, i) => {
      const x = 16 + i * 26 + rnd(-3, 3);
      const y = 31 + rnd(-4, 4);
      return `<text x="${x}" y="${y}" transform="rotate(${rnd(-22, 22)} ${x} ${y})" font-size="${rnd(22, 28)}" font-family="Arial, sans-serif" font-weight="700" fill="hsl(${rnd(0, 360)},70%,72%)">${ch}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="8" fill="#1b1b24"/>${dots}${lines}${chars}</svg>`;
}

export function createCaptcha() {
  const now = Date.now();
  for (const [k, v] of store) if (v.exp < now) store.delete(k);
  let text = '';
  for (let i = 0; i < 4; i++) text += CHARS[crypto.randomInt(CHARS.length)];
  const uuid = crypto.randomUUID();
  store.set(uuid, { text, exp: now + TTL });
  return { uuid, img: `data:image/svg+xml;base64,${Buffer.from(svgFor(text)).toString('base64')}` };
}

/** 开启验证码时校验；答案一次性 */
export function verifyCaptcha(uuid, code) {
  if (!captchaEnabled()) return;
  const rec = uuid ? store.get(uuid) : null;
  if (uuid) store.delete(uuid);
  if (!code) throw bad('请输入验证码');
  if (!rec || rec.exp < Date.now()) throw bad('验证码已过期，请刷新');
  if (rec.text !== String(code).trim().toUpperCase()) throw bad('验证码不正确');
}
