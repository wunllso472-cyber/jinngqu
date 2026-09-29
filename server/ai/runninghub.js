// RunningHub 工作流适配器
// 工作流与节点映射在 config/runninghub.json 中配置（参考 config/runninghub.example.json）。
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { composeCheckin } from './compose.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cached = null;
export function loadWorkflows() {
  if (cached) return cached;
  const file = config.runninghub.workflowFile;
  if (!fs.existsSync(file)) return (cached = {});
  cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cached;
}

export function runninghubReady(serviceType) {
  const wf = loadWorkflows()[serviceType];
  return !!(config.runninghub.apiKey && wf && wf.workflowId);
}

async function call(pathname, body) {
  const res = await fetch(`${config.runninghub.baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: new URL(config.runninghub.baseUrl).host },
    body: JSON.stringify({ apiKey: config.runninghub.apiKey, ...body }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.code !== 0) {
    throw new Error(`RunningHub ${pathname} 失败：${json?.msg || res.status}`);
  }
  return json.data;
}

async function upload(file, fileType) {
  const form = new FormData();
  form.append('apiKey', config.runninghub.apiKey);
  form.append('fileType', fileType);
  form.append('file', new Blob([await fs.promises.readFile(file)]), path.basename(file));
  const res = await fetch(`${config.runninghub.baseUrl}/task/openapi/upload`, { method: 'POST', body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.code !== 0) throw new Error(`RunningHub 上传失败：${json?.msg || res.status}`);
  return json.data.fileName;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载生成结果失败：${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const runninghubProvider = {
  name: 'runninghub',

  async generate(ctx) {
    const { template, files } = ctx;
    const wf = loadWorkflows()[template.service_type];
    if (!wf?.workflowId) throw new Error(`未配置 ${template.service_type} 的 RunningHub 工作流`);

    let taskId = ctx.order.provider_task;
    if (!taskId) {
      await ctx.progress(10, '上传素材');
      const sources = { body: files.body, face: files.face, base: files.base, background: files.background, video: files.video };
      const nodeInfoList = [];
      for (const [input, spec] of Object.entries(wf.inputs || {})) {
        const src = sources[input];
        if (!src) {
          if (spec.required) throw new Error(`缺少必需素材：${input}`);
          continue;
        }
        const fileName = await upload(src, input === 'video' ? 'video' : 'image');
        nodeInfoList.push({ nodeId: String(spec.nodeId), fieldName: spec.fieldName || 'image', fieldValue: fileName });
      }
      for (const extra of wf.params || []) nodeInfoList.push(extra);
      await ctx.progress(20, '提交 AI 任务');
      const data = await call('/task/openapi/create', { workflowId: String(wf.workflowId), nodeInfoList });
      taskId = String(data.taskId);
      await ctx.setTask(taskId);
    }

    const started = Date.now();
    let progress = 25;
    for (;;) {
      if (Date.now() - started > config.runninghub.timeoutMs) throw new Error('AI 任务超时');
      const status = await call('/task/openapi/status', { taskId });
      if (status === 'SUCCESS') break;
      if (status === 'FAILED') throw new Error('AI 任务执行失败');
      progress = Math.min(90, progress + 2);
      await ctx.progress(progress, status === 'QUEUED' ? '排队中' : 'AI 生成中');
      await sleep(5000);
    }

    await ctx.progress(92, '下载生成结果');
    const outputs = await call('/task/openapi/outputs', { taskId });
    const want = template.service_type === 'OUTFIT_VIDEO' ? /\.(mp4|mov|webm)$/i : /\.(png|jpe?g|webp)$/i;
    const hit = (outputs || []).find((o) => want.test(o.fileUrl || '')) || (outputs || [])[0];
    if (!hit?.fileUrl) throw new Error('AI 任务没有返回结果文件');
    const buffer = await download(hit.fileUrl);

    if (template.service_type === 'CHECKIN') {
      // 打卡合拍：工作流只负责抠像，合成在本地按锚点完成
      const composed = await composeCheckin({
        background: files.background,
        person: buffer,
        cutout: true,
        anchorX: template.anchor_x,
        anchorY: template.anchor_y,
        personHeight: template.person_height,
      });
      return { buffer: composed, ext: 'jpg', kind: 'image' };
    }
    const ext = (hit.fileUrl.match(/\.([a-z0-9]{2,4})(?:\?|$)/i)?.[1] || (template.service_type === 'OUTFIT_VIDEO' ? 'mp4' : 'png')).toLowerCase();
    return { buffer, ext, kind: template.service_type === 'OUTFIT_VIDEO' ? 'video' : 'image' };
  },
};
