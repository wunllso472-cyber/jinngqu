// 本地图像合成：模拟 AI 的输出，以及把抠像结果按锚点贴到景区背景上
import sharp from 'sharp';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

/**
 * 人物“贴纸”：没有真实抠像时，用羽化的椭圆遮罩让人物照片自然地融入背景。
 * 若输入本身带透明通道（真实抠像结果），则直接使用。
 */
export async function personLayer(input, targetHeight, { cutout = false } = {}) {
  const resized = await sharp(input).rotate().resize({ height: Math.max(40, Math.round(targetHeight)) }).ensureAlpha().png().toBuffer({ resolveWithObject: true });
  if (cutout) return resized;
  const { width: w, height: h } = resized.info;
  const mask = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="g" cx="50%" cy="48%" r="58%">
        <stop offset="68%" stop-color="#fff" stop-opacity="1"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </radialGradient></defs>
      <ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="url(#g)"/>
    </svg>`,
  );
  const data = await sharp(resized.data).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return { data, info: resized.info };
}

function watermark(width, height, text) {
  const fs = Math.max(14, Math.round(width / 42));
  const pad = Math.round(fs * 0.8);
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width - pad}" y="${height - pad}" text-anchor="end" font-family="Microsoft YaHei, PingFang SC, sans-serif"
        font-size="${fs}" fill="#ffffff" fill-opacity="0.82" stroke="#000" stroke-opacity="0.25" stroke-width="1">${escapeXml(text)}</text>
    </svg>`,
  );
}

/**
 * 打卡合拍：把人物放在背景的锚点（人物脚底中心）处，高度为 personHeight 像素。
 */
export async function composeCheckin({ background, person, anchorX, anchorY, personHeight, cutout = false, label = 'AI 合成' }) {
  const bg = sharp(background).rotate();
  const meta = await bg.metadata();
  const W = meta.width;
  const H = meta.height;
  const ph = clamp(personHeight || Math.round(H * 0.55), 40, H);
  const layer = await personLayer(person, ph, { cutout });
  let { data, info } = layer;
  if (info.width > W) {
    const r = await sharp(data).resize({ width: W }).png().toBuffer({ resolveWithObject: true });
    data = r.data;
    info = r.info;
  }
  const ax = anchorX ?? Math.round(W / 2);
  const ay = anchorY ?? Math.round(H * 0.92);
  const left = clamp(Math.round(ax - info.width / 2), 0, W - info.width);
  const top = clamp(Math.round(ay - info.height), 0, H - info.height);
  const shadowW = Math.round(info.width * 0.7);
  const shadowH = Math.max(6, Math.round(info.height * 0.035));
  const shadow = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="b"><feGaussianBlur stdDeviation="${Math.max(2, shadowH / 2)}"/></filter></defs>
     <ellipse cx="${left + info.width / 2}" cy="${Math.min(H - shadowH, top + info.height - shadowH / 2)}" rx="${shadowW / 2}" ry="${shadowH}" fill="#000" fill-opacity="0.35" filter="url(#b)"/></svg>`,
  );
  return bg
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: data, left, top },
      { input: watermark(W, H, label), left: 0, top: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * AI 换装照片的本地模拟：白模场景 + 人物模板。
 * 真实效果由模型完成；模拟版把人物放在白模人物所在位置并加上人脸小窗，便于走通全流程。
 */
export async function composeOutfitPhoto({ base, body, face, label = 'AI 演示 · 模拟生成' }) {
  const bg = sharp(base).rotate().resize({ width: 1080, height: 1440, fit: 'cover' });
  const W = 1080;
  const H = 1440;
  const layer = await personLayer(body, H * 0.62);
  let { data, info } = layer;
  if (info.width > W * 0.8) {
    const r = await sharp(data).resize({ width: Math.round(W * 0.8) }).png().toBuffer({ resolveWithObject: true });
    data = r.data;
    info = r.info;
  }
  const composites = [{ input: data, left: Math.round((W - info.width) / 2), top: Math.round(H * 0.9 - info.height) }];
  if (face) {
    const size = 220;
    const circle = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
    const faceImg = await sharp(face).rotate().resize(size, size, { fit: 'cover', position: 'attention' }).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
    const ring = Buffer.from(`<svg width="${size + 12}" height="${size + 12}"><circle cx="${(size + 12) / 2}" cy="${(size + 12) / 2}" r="${(size + 8) / 2}" fill="none" stroke="#f3cf7a" stroke-width="6"/></svg>`);
    composites.push({ input: faceImg, left: 48, top: 48 }, { input: ring, left: 42, top: 42 });
  }
  composites.push({ input: watermark(W, H, label), left: 0, top: 0 });
  return bg.composite(composites).jpeg({ quality: 90 }).toBuffer();
}

/** 统一尺寸的帧，用于拼接视频 */
export async function toFrame(buffer, width = 1080, height = 1440) {
  return sharp(buffer).resize({ width, height, fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
}
