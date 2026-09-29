// 本地模拟 AI：不调用任何外部服务，用图像合成走通“下单 → 制作 → 出片 / 失败退款”全流程
import fs from 'node:fs';
import { all, getSetting } from '../db.js';
import { absPath } from '../storage.js';
import { composeCheckin, composeOutfitPhoto, personLayer, toFrame } from './compose.js';
import { framesToVideo, overlayOnVideo } from './video.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function maybeFail(ctx) {
  const rate = Number(getSetting('mock.fail_rate', '0')) || 0;
  if (rate > 0 && Math.random() * 100 < rate) {
    throw new Error('模拟失败：AI 服务返回异常（管理员设置了模拟失败率）');
  }
  if (/失败测试/.test(ctx.character?.name || '')) {
    throw new Error('模拟失败：人物模板名称包含“失败测试”');
  }
}

async function steps(ctx, list, scale = 1) {
  for (const [progress, stage, ms] of list) {
    await ctx.progress(progress, stage);
    await sleep(ms * scale);
  }
}

export const mockProvider = {
  name: 'mock',

  async generate(ctx) {
    const speed = Number(process.env.MOCK_SPEED || 1);
    const { template, files } = ctx;
    const body = await fs.promises.readFile(files.body);

    if (template.service_type === 'CHECKIN') {
      await steps(ctx, [[15, '人物识别中', 800], [45, '人物抠像中', 1200], [75, '按锚点合成背景', 800]], speed);
      maybeFail(ctx);
      const buffer = await composeCheckin({
        background: files.background,
        person: body,
        anchorX: template.anchor_x,
        anchorY: template.anchor_y,
        personHeight: template.person_height,
        label: 'AI 合成 · 打卡合拍',
      });
      return { buffer, ext: 'jpg', kind: 'image' };
    }

    if (template.service_type === 'OUTFIT_PHOTO') {
      await steps(ctx, [[10, '排队中', 800], [30, '解析白模场景与动作', 1500], [60, 'AI 换装生成中', 2500], [85, '细节修复', 1200]], speed);
      maybeFail(ctx);
      const face = files.face ? await fs.promises.readFile(files.face) : null;
      const buffer = await composeOutfitPhoto({ base: files.base, body, face });
      return { buffer, ext: 'jpg', kind: 'image' };
    }

    await steps(ctx, [[8, '排队中', 800], [20, '分析动作参考', 1500], [40, 'AI 生成人物动作', 2500], [65, '逐镜头合成', 1500]], speed);
    maybeFail(ctx);

    // 有模板样片：人物叠加到样片上，保留原片节奏与音轨
    if (files.video) {
      await ctx.progress(75, template.video_pipeline === 'MULTI_SHOT' ? '按镜头合成整片' : '合成视频');
      const { data } = await personLayer(body, 900);
      const buffer = await overlayOnVideo(files.video, data);
      return { buffer, ext: 'mp4', kind: 'video' };
    }

    // 无样片：把人物依次放进景区的多处风景，每处停留 1 秒，共 7 秒
    const backgrounds = [];
    if (files.background) backgrounds.push({ path: files.background, t: template });
    const scenic = all(
      "SELECT * FROM templates WHERE scene_id = ? AND service_type = 'CHECKIN' AND status = 'ON' AND background IS NOT NULL ORDER BY featured DESC, sort DESC, id LIMIT 7",
      template.scene_id,
    );
    for (const t of scenic) backgrounds.push({ path: absPath(t.background), t });
    if (!backgrounds.length && template.cover) backgrounds.push({ path: absPath(template.cover), t: template });
    if (!backgrounds.length) throw new Error('模板缺少可用的背景素材');

    const frames = [];
    for (const [i, bg] of backgrounds.slice(0, 7).entries()) {
      const img = await composeCheckin({
        background: bg.path,
        person: body,
        anchorX: bg.t.anchor_x,
        anchorY: bg.t.anchor_y,
        personHeight: bg.t.person_height,
        label: 'AI 生成 · 演示视频',
      });
      frames.push(await toFrame(img));
      await ctx.progress(65 + Math.round(((i + 1) / Math.min(7, backgrounds.length)) * 20), '逐镜头合成');
    }
    await ctx.progress(90, '编码视频');
    const buffer = await framesToVideo(frames, 7);
    return { buffer, ext: 'mp4', kind: 'video' };
  },
};
