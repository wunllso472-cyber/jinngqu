import { config } from './config.js';
import { scalar } from './db.js';
import { createApp } from './app.js';
import { startWorker } from './ai/worker.js';
import { hasFfmpeg } from './ai/video.js';

if (!scalar('SELECT COUNT(*) FROM users')) {
  const { seed } = await import('./seed.js');
  await seed();
}

const app = createApp();
app.listen(config.port, () => {
  console.log(`景区 AI 旅拍服务已启动：http://localhost:${config.port}`);
  console.log(`AI 提供方：${config.aiProvider}${config.aiProvider === 'mock' ? '（本地模拟，不消耗任何第三方余额）' : ''}；ffmpeg：${hasFfmpeg() ? '可用' : '不可用'}`);
});
startWorker();
