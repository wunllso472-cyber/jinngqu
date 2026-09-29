// 从原站（yingmu.fun）拉取公开素材与模板数据，保存到 server/seed-assets/origin/
// 用法：node scripts/fetch-origin-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = process.env.ORIGIN_URL || 'https://www.yingmu.fun';
const API = `${ORIGIN}/backend`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'server', 'seed-assets', 'origin');
// 界面图标、欢迎页等静态素材直接放到前端 public 目录
const uiDir = path.join(root, 'web', 'public', 'origin');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(uiDir, { recursive: true });

// 原站接口返回的内网地址需映射到 /backend 反向代理
const toPublic = (url) => {
  if (!url) return null;
  if (url.startsWith('http://8.160.164.214/')) return `${API}/${url.slice('http://8.160.164.214/'.length)}`;
  if (url.startsWith('/dressup/') || url.startsWith('/media-preview/')) return `${API}${url}`;
  if (url.startsWith('/')) return `${ORIGIN}${url}`;
  return url;
};

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3' };

async function download(url, name, dir = outDir) {
  const src = toPublic(url);
  if (!src) return null;
  const res = await fetch(src);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!res.ok || !(type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/'))) {
    console.warn(`  ✗ ${src} → ${res.status} ${type}`);
    return null;
  }
  const file = `${name}.${EXT[type] || src.split('.').pop().split('?')[0]}`;
  fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
  console.log(`  ✓ ${file}`);
  return file;
}

async function json(p) {
  const res = await fetch(API + p);
  const body = await res.json();
  if (body.code !== 200) throw new Error(`${p}: ${body.msg}`);
  return body.data;
}

const manifest = { origin: ORIGIN, fetchedAt: new Date().toISOString(), scenes: [], templates: [], ui: {} };

// 景区与服务定价
const services = await json('/dressup/commerce/scenes');
const sceneMap = new Map();
for (const s of services) {
  if (!sceneMap.has(s.sceneId)) sceneMap.set(s.sceneId, { id: s.sceneId, name: s.name, enabled: !!s.sceneEnabled, services: {} });
  sceneMap.get(s.sceneId).services[s.kind] = { enabled: !!s.enabled, remaining: s.remaining, retailFen: s.retailFen };
}
manifest.scenes = [...sceneMap.values()];

// 模板目录
const items = [];
for (let page = 1; ; page++) {
  const data = await json(`/dressup/catalog?page=${page}&size=50`);
  items.push(...(data.items || []));
  if (!data.items || data.items.length < 50) break;
}
for (const it of items) {
  const t = await json(`/dressup/catalog/${encodeURIComponent(it.templateCode)}`);
  console.log(`模板 ${t.templateCode}（${t.title}）`);
  const code = t.templateCode;
  const entry = {
    code,
    type: t.templateType,
    title: t.title,
    description: t.description,
    tags: t.tags || '',
    featured: !!t.featured,
    sortOrder: t.sortOrder,
    retailFen: t.retailFen,
    videoPipeline: t.videoPipeline,
    cover: await download(t.imageUrl || t.coverPath, `${code}-cover`),
    scene: t.sceneUrl ? await download(t.sceneUrl, `${code}-scene`) : null,
    video: t.videoUrl ? await download(t.videoUrl, `${code}-video`) : null,
  };
  // 打卡模板的高清背景（接口存在时）
  if (t.templateType === 'SCENIC_CHECKIN') entry.background = await download(`/dressup/catalog/${code}/scene`, `${code}-background`);
  manifest.templates.push(entry);
}

// 界面图标与首页素材
const UI = {
  'icon-checkin': '/media-preview/home-icons/v2/scenic-checkin.png',
  'icon-outfit-photo': '/media-preview/home-icons/v2/outfit-photo.png',
  'icon-outfit-video': '/media-preview/home-icons/v2/outfit-video.png',
  'icon-characters': '/media-preview/home-icons/v2/character-manager.png',
  'icon-service': '/media-preview/profile/icons/customer-service.png',
  'icon-favorite': '/media-preview/profile/icons/favorite.png',
  'icon-order': '/media-preview/profile/icons/order.png',
  'icon-print': '/media-preview/profile/icons/print-voucher.png',
  'icon-redeem': '/media-preview/profile/icons/redeem-code.png',
  'avatar-default': '/media-preview/profile/icons/default-avatar-female.png',
  'profile-hero': '/media-preview/profile/profile-hero-v1.jpg',
  'welcome-poster': '/assets/welcome-lite-v2.jpg',
  'welcome-video': '/assets/welcome-lite-v2.mp4',
  'scan-poster': '/assets/scan-lite-v3.jpg',
  'scan-video': '/assets/scan-lite-v3.mp4',
};
console.log('界面素材');
for (const [name, url] of Object.entries(UI)) manifest.ui[name] = await download(url, name, uiDir);

// 首页展示图（/assets/display/*.webp）
const bundleHtml = await (await fetch(ORIGIN)).text();
const bundleJs = bundleHtml.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
manifest.display = [];
if (bundleJs) {
  const js = await (await fetch(ORIGIN + bundleJs)).text();
  const paths = [...new Set(js.match(/\/assets\/display\/[a-f0-9]+\.webp/g) || [])];
  console.log(`首页展示图 ${paths.length} 张`);
  for (const [i, p] of paths.entries()) {
    const f = await download(p, `display-${String(i + 1).padStart(2, '0')}`, uiDir);
    if (f) manifest.display.push(f);
  }
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`完成：${outDir}`);
