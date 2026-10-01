import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { loadUser } from './auth.js';
import { absPath, isValidKey, verifySignature } from './storage.js';
import { ApiError } from './util.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import visitorRoutes from './routes/visitor.js';
import ticketRoutes from './routes/tickets.js';
import merchantRoutes from './routes/merchant.js';
import adminRoutes from './routes/admin.js';
import printRoutes, { printStaff } from './routes/print.js';
import { codes as codeRoutes, points as pointRoutes } from './routes/codes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));

  // 文件访问：public 直接返回；private 需签名
  app.get('/files/*', (req, res) => {
    const key = req.params[0];
    if (!isValidKey(key)) return res.status(404).end();
    if (!verifySignature(key, req.query.e, req.query.s)) return res.status(403).send('链接已过期，请刷新页面');
    const file = absPath(key);
    if (req.query.dl) res.attachment(`scenic-${path.basename(file)}`);
    res.set('Cache-Control', key.startsWith('public/') ? 'public, max-age=86400' : 'private, max-age=3600');
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(err.status === 404 ? 404 : 500).end();
    });
  });

  const api = express.Router();
  api.use(loadUser);
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRoutes);
  api.use('/tickets', ticketRoutes);
  api.use('/prints', printRoutes);
  api.use('/print-staff', printStaff);
  api.use('/points', pointRoutes);
  api.use('/codes', codeRoutes);
  api.use('/merchant', merchantRoutes);
  api.use('/admin', adminRoutes);
  api.use('/', publicRoutes);
  api.use('/', visitorRoutes);
  api.use((_req, _res, next) => next(new ApiError(404, '接口不存在')));
  app.use('/api', api);

  // 前端构建产物（SPA）
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/files')) return next();
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件过大' : '上传失败，请重新选择文件';
      return res.status(400).json({ message: msg });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ message: '请求格式错误' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ message: status >= 500 ? '服务器开小差了，请稍后重试' : err.message, code: err.code });
  });
  return app;
}
