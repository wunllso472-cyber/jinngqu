// 制作队列：轮询已支付订单，调用 AI 提供方，成功出片或失败退款
import { config } from '../config.js';
import { one, run } from '../db.js';
import { failAndRefund } from '../domain.js';
import { absPath, saveBuffer } from '../storage.js';
import { now } from '../util.js';
import { mockProvider } from './mock.js';
import { runninghubProvider, runninghubReady } from './runninghub.js';

export function providerFor(serviceType) {
  if (config.aiProvider === 'runninghub' && runninghubReady(serviceType)) return runninghubProvider;
  return mockProvider;
}

const running = new Set();
let timer = null;

async function processOrder(order) {
  const template = one('SELECT * FROM templates WHERE id = ?', order.template_id);
  const character = order.character_id ? one('SELECT * FROM characters WHERE id = ?', order.character_id) : null;
  const scene = one('SELECT * FROM scenes WHERE id = ?', order.scene_id);
  if (!template) throw new Error('模板不存在');
  if (!character) throw new Error('人物模板不存在或已删除');

  const baseKey = order.custom_base || template.base_image;
  const files = {
    body: absPath(character.body_image),
    face: character.face_image ? absPath(character.face_image) : null,
    base: baseKey ? absPath(baseKey) : null,
    background: template.background ? absPath(template.background) : null,
    video: template.sample_video ? absPath(template.sample_video) : null,
  };
  if (template.service_type === 'CHECKIN' && !files.background) throw new Error('模板尚未上传高清背景');
  if (template.service_type === 'OUTFIT_PHOTO' && !files.base) throw new Error('缺少白模场景图');

  const provider = providerFor(template.service_type);
  run('UPDATE orders SET provider = ? WHERE id = ?', provider.name, order.id);

  const ctx = {
    order,
    template,
    character,
    scene,
    files,
    progress: async (progress, stage) => {
      run("UPDATE orders SET progress = ?, stage = ? WHERE id = ? AND status = 'PROCESSING'", Math.min(99, progress), stage, order.id);
    },
    setTask: async (taskId) => {
      run('UPDATE orders SET provider_task = ? WHERE id = ?', taskId, order.id);
    },
  };

  const result = await provider.generate(ctx);
  const key = await saveBuffer(result.buffer, { scope: 'private', folder: 'results', ext: result.ext });
  const changed = run(
    `UPDATE orders SET status = 'SUCCESS', progress = 100, stage = '制作完成', result_key = ?, result_kind = ?, finished_at = ?
     WHERE id = ? AND status = 'PROCESSING'`,
    key,
    result.kind,
    now(),
    order.id,
  ).changes;
  if (!changed) throw new Error('订单状态已变化');
}

function tick() {
  while (running.size < config.workerConcurrency) {
    const order = one("SELECT * FROM orders WHERE status = 'QUEUED' ORDER BY paid_at, id LIMIT 1");
    if (!order) return;
    const claimed = run(
      "UPDATE orders SET status = 'PROCESSING', started_at = COALESCE(started_at, ?), progress = 5, stage = '准备素材' WHERE id = ? AND status = 'QUEUED'",
      now(),
      order.id,
    ).changes;
    if (!claimed) continue;
    running.add(order.id);
    processOrder(one('SELECT * FROM orders WHERE id = ?', order.id))
      .catch((err) => {
        console.error(`[worker] 订单 ${order.order_no} 制作失败：`, err.message);
        failAndRefund(order.id, err.message);
      })
      .finally(() => running.delete(order.id));
  }
}

export function startWorker() {
  // 服务重启时，把中断的制作重新排队（已提交到 RunningHub 的任务会继续轮询原任务）
  run("UPDATE orders SET status = 'QUEUED' WHERE status = 'PROCESSING'");
  timer = setInterval(tick, 1000);
  timer.unref?.();
  tick();
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export const workerBusy = () => running.size;
