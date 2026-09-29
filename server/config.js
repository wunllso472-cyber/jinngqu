import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const file = path.join(dataDir, '.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret);
  return secret;
}

export const config = {
  root,
  dataDir,
  uploadDir: path.join(dataDir, 'files'),
  webDist: path.join(root, 'web', 'dist'),
  port: Number(process.env.PORT || 3000),
  secret: loadSecret(),
  sessionDays: Number(process.env.SESSION_DAYS || 7),
  // mock：本地模拟生成（不消耗任何第三方余额）；runninghub：调用 RunningHub 工作流
  aiProvider: (process.env.AI_PROVIDER || 'mock').toLowerCase(),
  workerConcurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY || 2)),
  runninghub: {
    apiKey: process.env.RUNNINGHUB_API_KEY || '',
    baseUrl: (process.env.RUNNINGHUB_BASE_URL || 'https://www.runninghub.cn').replace(/\/$/, ''),
    workflowFile: process.env.RUNNINGHUB_WORKFLOWS || path.join(root, 'config', 'runninghub.json'),
    timeoutMs: Number(process.env.RUNNINGHUB_TIMEOUT_MS || 20 * 60 * 1000),
  },
};
fs.mkdirSync(config.uploadDir, { recursive: true });
