// 初始化数据：三类测试账号、景区（老君山已绑定商户）、各服务模板与原创插画素材
// 用法：npm run seed:reset （清空 data 目录后重建）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCOUNTS = [
  { username: 'trial_user', password: process.env.SEED_USER_PASSWORD || '4l4pXByvM9UB__RayrW6', nickname: '体验游客', role: 'visitor' },
  { username: 'trial_merchant', password: process.env.SEED_MERCHANT_PASSWORD || 'cs6fH9o_RoXVrjIDKhz5', nickname: '老君山旅拍服务点', role: 'merchant' },
  { username: 'trial_admin', password: process.env.SEED_ADMIN_PASSWORD || 'XPEhwjxDl3Po5bZFm1hq', nickname: '平台管理员', role: 'admin' },
];

const SCENES = [
  {
    key: 'laojun',
    name: '老君山',
    subtitle: '一键换装打卡，生成畅玩视频，乐游老君山',
    city: '洛阳 · 栾川',
    intro: '金顶道观群坐落于海拔两千余米的峰顶，云海、栈道与十里画屏是游客最爱的取景地。',
    palette: 'dawn',
    merchant: 'trial_merchant',
    merchantName: '老君山旅拍服务点',
    servicePhone: '0379-00000000',
    serviceHours: '每天 08:00–18:00',
    status: 'ACTIVE',
    quota: { CHECKIN: 50, OUTFIT_PHOTO: 10, OUTFIT_VIDEO: 3 },
    sort: 100,
    templates: [
      { type: 'CHECKIN', title: '金顶云海 · 祈福合影', tags: '祈福 · 日出 · 金顶', palette: 'dawn', seed: 11, featured: 1, intro: '日出时分的金顶与云海，站在观景台前留下同款高清合影。' },
      { type: 'CHECKIN', title: '十里画屏 · 栈道留影', tags: '栈道 · 青山', palette: 'jade', seed: 12, intro: '层层青峰如屏风展开，适合全身照打卡。' },
      { type: 'CHECKIN', title: '南天门 · 夕照打卡', tags: '夕阳 · 氛围感', palette: 'dusk', seed: 13, intro: '晚霞铺满天空，暖色调人像更有氛围。' },
      { type: 'CHECKIN', title: '马鬃岭 · 雪后初晴', tags: '雪景 · 冬季限定', palette: 'snow', seed: 14, templeOn: false, intro: '雪后放晴的山脊线，冬季限定打卡位。' },
      { type: 'OUTFIT_PHOTO', title: '道韵古风 · 云端问道', tags: '古风 · 道袍', palette: 'ink', seed: 21, pose: 1, featured: 1, intro: '水墨山色中的古风造型，白模提供动作与构图，人物模板提供长相与服装。' },
      { type: 'OUTFIT_PHOTO', title: '侠客行 · 山巅剑影', tags: '侠客 · 武侠', palette: 'dusk', seed: 22, pose: 2, intro: '夕照山巅的侠客站姿，适合身形挺拔的全身照。' },
      { type: 'OUTFIT_PHOTO', title: '春日游园 · 峰顶花开', tags: '汉服 · 春游 · 亲子', palette: 'jade', seed: 23, pose: 0, intro: '青绿山水与明快色调，日常与汉服造型都适合。' },
      { type: 'OUTFIT_VIDEO', title: '云上老君山 · 七景巡游', tags: '7秒 · 多景点', palette: 'dawn', seed: 31, featured: 1, intro: '跟随固定动作，走进老君山七处风景，每处风景停留 1 秒，共 7 秒。' },
      { type: 'OUTFIT_VIDEO', title: '金顶晨光 · 漫步短片', tags: '竖版 · 慢镜', palette: 'snow', seed: 32, intro: '以金顶与雪岭为背景的竖版漫步短片。' },
    ],
  },
  {
    key: 'jiguan',
    name: '鸡冠洞',
    subtitle: '溶洞奇观，光影秘境',
    city: '洛阳 · 栾川',
    intro: '暂未绑定景区商户，服务尚未开放。',
    palette: 'cave',
    status: 'PAUSED',
    sort: 50,
    templates: [{ type: 'CHECKIN', title: '溶洞秘境 · 光影合影', tags: '溶洞 · 光影', palette: 'cave', seed: 41, templeOn: false, intro: '幽蓝光影的溶洞大厅。' }],
  },
  {
    key: 'chongdu',
    name: '重渡沟',
    subtitle: '竹海飞瀑，山水田园',
    city: '洛阳 · 栾川',
    intro: '暂未绑定景区商户，服务尚未开放。',
    palette: 'valley',
    status: 'PAUSED',
    sort: 40,
    templates: [{ type: 'CHECKIN', title: '竹海飞瀑 · 清凉一夏', tags: '竹林 · 瀑布', palette: 'valley', seed: 51, templeOn: false, intro: '满目青翠的竹海与溪瀑。' }],
  },
];

const ORIGIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-assets', 'origin');
const ORIGIN_TYPE = { SCENIC_CHECKIN: 'CHECKIN', OUTFIT_PHOTO: 'OUTFIT_PHOTO', OUTFIT_VIDEO: 'OUTFIT_VIDEO' };

/** 读取 scripts/fetch-origin-assets.mjs 拉取的原站数据，转换为种子格式 */
function originScenes() {
  const file = path.join(ORIGIN_DIR, 'manifest.json');
  if (process.env.SEED_SOURCE === 'generated' || !fs.existsSync(file)) return null;
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const quotaOf = (s) => ({
    CHECKIN: s.services.SCENIC_CHECKIN?.remaining ?? 0,
    OUTFIT_PHOTO: s.services.OUTFIT_PHOTO?.remaining ?? 0,
    OUTFIT_VIDEO: s.services.OUTFIT_VIDEO?.remaining ?? 0,
  });
  return m.scenes.map((s, idx) => {
    const main = idx === 0;
    return {
      key: `origin-${s.id}`,
      name: s.name,
      subtitle: main ? '一键换装打卡，生成畅玩视频，乐游老君山' : '',
      city: main ? '洛阳 · 栾川' : '',
      intro: main ? '进入景区，发现你的新形象' : '测试景区，服务暂停',
      coverFile: main ? path.join(ORIGIN_DIR, '..', '..', '..', 'web', 'public', 'origin', 'welcome-poster.jpg') : null,
      palette: main ? 'dawn' : 'ink',
      merchant: main ? 'trial_merchant' : null,
      merchantName: main ? '老君山旅拍服务点' : '',
      servicePhone: main ? '0379-00000000' : '',
      serviceHours: main ? '每天 08:00–18:00' : '',
      status: main && s.enabled ? 'ACTIVE' : 'PAUSED',
      quota: quotaOf(s),
      sort: 100 - idx,
      templates: main
        ? m.templates.map((t) => ({
            origin: true,
            code: t.code,
            type: ORIGIN_TYPE[t.type],
            title: t.title,
            intro:
              t.code === 'scenic-outfit-video'
                ? `${t.description}\n音乐：Eastern Thought — Kevin MacLeod（incompetech.com），CC BY 4.0；使用7秒节选。`
                : t.description,
            tags: t.tags,
            featured: t.featured ? 1 : 0,
            sortOrder: t.sortOrder,
            price: t.retailFen,
            videoPipeline: t.videoPipeline,
            coverFile: t.cover && path.join(ORIGIN_DIR, t.cover),
            baseFile: t.scene && path.join(ORIGIN_DIR, t.scene),
            videoFile: t.video && path.join(ORIGIN_DIR, t.video),
            backgroundFile: t.background && path.join(ORIGIN_DIR, t.background),
            // 原站打卡模板默认画布 941×1672，锚点为人物脚底中心
            palette: 'dawn',
            seed: 61,
          }))
        : [],
    };
  });
}

export async function seed({ log = console.log } = {}) {
  const sharp = (await import('sharp')).default;
  const { db, run, one, tx } = await import('./db.js');
  const { hashPassword } = await import('./auth.js');
  const { saveBuffer, copyFileIn } = await import('./storage.js');
  const { SERVICE_TYPES } = await import('./constants.js');
  const { adjustQuota, initSceneServices } = await import('./domain.js');
  const { landscapeSvg } = await import('./seed-art.js');
  const { now } = await import('./util.js');

  if (one('SELECT 1 FROM users LIMIT 1')) {
    log('[seed] 数据库已有数据，跳过初始化');
    return;
  }

  const png = async (svg, folder, width) => {
    let img = sharp(Buffer.from(svg));
    if (width) img = img.resize({ width });
    return saveBuffer(await img.jpeg({ quality: 88 }).toBuffer(), { scope: 'public', folder, ext: 'jpg' });
  };

  const t = now();
  const userIds = {};
  for (const a of ACCOUNTS) {
    userIds[a.username] = run(
      "INSERT INTO users (username, password_hash, nickname, role, status, merchant_name, created_at) VALUES (?, ?, ?, ?, 'ENABLED', ?, ?)",
      a.username,
      await hashPassword(a.password),
      a.nickname,
      a.role,
      a.role === 'merchant' ? a.nickname : '',
      t,
    ).lastInsertRowid;
  }

  const origin = originScenes();
  const scenes = origin || SCENES;
  if (origin) log('[seed] 使用原站素材（server/seed-assets/origin）');

  const copyIn = async (file, folder) => {
    if (!file || !fs.existsSync(file)) return null;
    const ext = path.extname(file).slice(1).toLowerCase();
    // webp 等统一转 jpg；png 保留（白模/透明图）
    if (['jpg', 'jpeg', 'png', 'mp4'].includes(ext)) return copyFileIn(file, { scope: 'public', folder, ext: ext === 'jpeg' ? 'jpg' : ext });
    return saveBuffer(await sharp(file).jpeg({ quality: 90 }).toBuffer(), { scope: 'public', folder, ext: 'jpg' });
  };

  for (const s of scenes) {
    const cover = s.coverFile
      ? await copyIn(s.coverFile, 'scenes')
      : await png(landscapeSvg({ w: 1200, h: 800, palette: s.palette, seed: s.sort, clouds: 2, sunPos: [0.75, 0.25] }), 'scenes');
    const templates = [];
    for (const tp of s.templates) {
      const art = { palette: tp.palette, seed: tp.seed, templeOn: tp.templeOn !== false };
      const item = { ...tp, cover: null, background: null, base: null, video: null };
      if (tp.origin) {
        item.cover = await copyIn(tp.coverFile, 'templates');
        item.base = await copyIn(tp.baseFile, 'templates');
        item.video = await copyIn(tp.videoFile, 'templates');
        if (tp.type === 'CHECKIN') {
          if (tp.backgroundFile) {
            item.background = await copyIn(tp.backgroundFile, 'templates');
            const meta = await sharp(tp.backgroundFile).metadata();
            const k = meta.width / 941;
            Object.assign(item, { bgW: meta.width, bgH: meta.height, ax: Math.round(560 * k), ay: Math.round(1496 * k), ph: Math.round(1020 * k) });
          } else {
            // 原站高清背景需管理员权限下载；暂用程序生成的背景，可在管理中心替换
            item.background = await png(landscapeSvg({ ...art, w: 941, h: 1672 }), 'templates');
            // 原站「金殿合拍」实际参数：画布 941×1672，脚底中心 (560, 1496)，人物高度 1020
            Object.assign(item, { bgW: 941, bgH: 1672, ax: 560, ay: 1496, ph: 1020 });
          }
        }
      } else if (tp.type === 'CHECKIN' || tp.type === 'OUTFIT_VIDEO') {
        item.background = await png(landscapeSvg({ ...art, w: 1080, h: 1440 }), 'templates');
        item.cover = await png(landscapeSvg({ ...art, w: 1080, h: 1440, figure: { x: 540, footY: 1300, height: 700, pose: 0 } }), 'templates', 720);
      } else {
        const svg = landscapeSvg({ ...art, w: 1080, h: 1440, figure: { x: 540, footY: 1330, height: 820, pose: tp.pose } });
        item.base = await png(svg, 'templates');
        item.cover = await png(svg, 'templates', 720);
      }
      templates.push(item);
    }

    tx(() => {
      const merchantId = s.merchant ? userIds[s.merchant] : null;
      const sceneId = run(
        `INSERT INTO scenes (name, subtitle, city, intro, cover, status, merchant_id, merchant_name, service_phone, service_hours, sort, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.name,
        s.subtitle,
        s.city,
        s.intro,
        cover,
        s.status,
        merchantId,
        s.merchantName || '',
        s.servicePhone || '',
        s.serviceHours || '',
        s.sort,
        t,
      ).lastInsertRowid;
      initSceneServices(sceneId);
      for (const type of SERVICE_TYPES) {
        const quota = s.quota?.[type] ?? 0;
        if (quota) adjustQuota(sceneId, type, quota, 'ADMIN', '初始化赠送');
      }
      templates.forEach((tp, i) => {
        const hasBg = !!tp.background;
        run(
          `INSERT INTO templates (scene_id, service_type, code, title, intro, tags, cover, background, bg_width, bg_height, base_image, sample_video,
             anchor_x, anchor_y, person_height, price, video_pipeline, owner_id, status, featured, sort, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ON', ?, ?, ?, ?, ?)`,
          sceneId,
          tp.type,
          tp.code ?? null,
          tp.title,
          tp.intro,
          tp.tags,
          tp.cover,
          tp.background,
          hasBg ? (tp.bgW ?? 1080) : null,
          hasBg ? (tp.bgH ?? 1440) : null,
          tp.base,
          tp.video ?? null,
          hasBg ? (tp.ax ?? 540) : null,
          hasBg ? (tp.ay ?? 1330) : null,
          hasBg ? (tp.ph ?? 760) : null,
          tp.price ?? null,
          tp.videoPipeline || 'LOOP',
          merchantId ?? userIds.trial_admin,
          tp.featured || 0,
          tp.sortOrder ?? 100 - i,
          userIds.trial_admin,
          t,
          t,
        );
      });
    });
    log(`[seed] 景区「${s.name}」：${templates.length} 个模板`);
  }
  log('[seed] 测试账号：trial_user（游客）/ trial_merchant（商户，绑定老君山）/ trial_admin（管理员）');
  return db;
}

// 直接运行：node server/seed.js [--reset]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--reset')) {
    const { config } = await import('./config.js');
    for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) fs.rmSync(path.join(config.dataDir, f), { force: true });
    fs.rmSync(config.uploadDir, { recursive: true, force: true });
    fs.mkdirSync(config.uploadDir, { recursive: true });
    console.log('[seed] 已清空数据目录');
  }
  await seed();
}
