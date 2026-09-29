// 游客端：景区、模板、点赞收藏
import { Router } from 'express';
import { all, one, run } from '../db.js';
import { sceneView, templateView } from '../domain.js';
import { SERVICE_TYPES } from '../constants.js';
import { requireAuth } from '../auth.js';
import { h, notFound, now, str } from '../util.js';

const r = Router();

r.get('/scenes', (req, res) => {
  const scenes = all('SELECT * FROM scenes ORDER BY sort DESC, id');
  res.json(scenes.map((s) => sceneView(s)));
});

r.get('/scenes/:id', (req, res) => {
  const scene = one('SELECT * FROM scenes WHERE id = ?', Number(req.params.id));
  if (!scene) throw notFound('景区不存在');
  res.json(sceneView(scene));
});

r.get('/scenes/:id/templates', (req, res) => {
  const sceneId = Number(req.params.id);
  const type = SERVICE_TYPES.includes(req.query.type) ? req.query.type : null;
  const q = str(req.query.q, 40);
  let sql = "SELECT * FROM templates WHERE scene_id = ? AND status = 'ON'";
  const params = [sceneId];
  if (type) {
    sql += ' AND service_type = ?';
    params.push(type);
  }
  if (q) {
    sql += ' AND (title LIKE ? OR tags LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY featured DESC, sort DESC, id DESC';
  let list = all(sql, ...params).map((t) => templateView(t, req.user?.id));
  if (req.query.sort === 'hot') list = list.sort((a, b) => b.uses + b.likes - (a.uses + a.likes));
  res.json(list);
});

r.get('/templates/:id', (req, res) => {
  const t = one("SELECT * FROM templates WHERE id = ? AND status != 'ARCHIVED'", Number(req.params.id));
  if (!t || (t.status !== 'ON' && !['admin'].includes(req.user?.role))) throw notFound('模板不存在或已下架');
  const scene = one('SELECT * FROM scenes WHERE id = ?', t.scene_id);
  res.json({ ...templateView(t, req.user?.id), scene: sceneView(scene) });
});

function toggle(table) {
  return h(async (req, res) => {
    const templateId = Number(req.params.id);
    const t = one("SELECT id FROM templates WHERE id = ? AND status = 'ON'", templateId);
    if (!t) throw notFound('模板不存在或已下架');
    const exists = one(`SELECT 1 FROM ${table} WHERE user_id = ? AND template_id = ?`, req.user.id, templateId);
    if (exists) run(`DELETE FROM ${table} WHERE user_id = ? AND template_id = ?`, req.user.id, templateId);
    else run(`INSERT INTO ${table} (user_id, template_id, created_at) VALUES (?, ?, ?)`, req.user.id, templateId, now());
    const view = templateView(one('SELECT * FROM templates WHERE id = ?', templateId), req.user.id);
    res.json({ active: !exists, likes: view.likes, favorites: view.favorites });
  });
}
r.post('/templates/:id/like', requireAuth, toggle('likes'));
r.post('/templates/:id/favorite', requireAuth, toggle('favorites'));

r.get('/favorites', requireAuth, (req, res) => {
  const rows = all(
    `SELECT t.* FROM favorites f JOIN templates t ON t.id = f.template_id
     WHERE f.user_id = ? AND t.status = 'ON' ORDER BY f.created_at DESC`,
    req.user.id,
  );
  res.json(rows.map((t) => templateView(t, req.user.id)));
});

export default r;
