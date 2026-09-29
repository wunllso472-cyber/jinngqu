import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'visitor' CHECK (role IN ('visitor','merchant','admin')),
  status TEXT NOT NULL DEFAULT 'ENABLED' CHECK (status IN ('ENABLED','DISABLED')),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  cover TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
  merchant_id INTEGER UNIQUE REFERENCES users(id),
  merchant_name TEXT NOT NULL DEFAULT '',
  service_phone TEXT NOT NULL DEFAULT '',
  service_hours TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scene_services (
  scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  quota INTEGER NOT NULL DEFAULT 0 CHECK (quota >= 0),
  visitor_price INTEGER NOT NULL,
  merchant_price INTEGER NOT NULL,
  PRIMARY KEY (scene_id, service_type)
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id INTEGER NOT NULL REFERENCES scenes(id),
  service_type TEXT NOT NULL,
  title TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  cover TEXT,
  background TEXT,
  bg_width INTEGER,
  bg_height INTEGER,
  base_image TEXT,
  sample_video TEXT,
  anchor_x INTEGER,
  anchor_y INTEGER,
  person_height INTEGER,
  price INTEGER,
  status TEXT NOT NULL DEFAULT 'OFF' CHECK (status IN ('ON','OFF','ARCHIVED')),
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_scene ON templates(scene_id, service_type, status);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  body_image TEXT NOT NULL,
  face_image TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETED')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id, status);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  file_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  scene_id INTEGER NOT NULL REFERENCES scenes(id),
  merchant_id INTEGER REFERENCES users(id),
  template_id INTEGER NOT NULL REFERENCES templates(id),
  character_id INTEGER REFERENCES characters(id),
  service_type TEXT NOT NULL,
  custom_base TEXT,
  amount INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('PENDING','QUEUED','PROCESSING','SUCCESS','FAILED','CANCELLED')),
  progress INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT '',
  result_key TEXT,
  result_kind TEXT,
  error TEXT,
  provider TEXT,
  provider_task TEXT,
  refund_amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  refunded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_scene ON orders(scene_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_template ON orders(template_id, status);

CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  template_id INTEGER NOT NULL REFERENCES templates(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id)
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id),
  template_id INTEGER NOT NULL REFERENCES templates(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id)
);

CREATE TABLE IF NOT EXISTS quota_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no TEXT NOT NULL UNIQUE,
  scene_id INTEGER NOT NULL REFERENCES scenes(id),
  merchant_id INTEGER NOT NULL REFERENCES users(id),
  service_type TEXT NOT NULL,
  count INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PAID','CANCELLED')),
  created_at TEXT NOT NULL,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS quota_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  actor_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quota_logs_scene ON quota_logs(scene_id, id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  withdrawal_no TEXT NOT NULL UNIQUE,
  merchant_id INTEGER NOT NULL REFERENCES users(id),
  scene_id INTEGER REFERENCES scenes(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','PAID','REJECTED','CANCELLED')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewer_id INTEGER,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_merchant ON withdrawals(merchant_id, status);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  scene_id INTEGER REFERENCES scenes(id),
  order_id INTEGER REFERENCES orders(id),
  merchant_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','REPLIED','CLOSED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS print_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  scene_id INTEGER NOT NULL REFERENCES scenes(id),
  merchant_id INTEGER REFERENCES users(id),
  paper TEXT NOT NULL,
  copies INTEGER NOT NULL CHECK (copies BETWEEN 1 AND 10),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('PENDING','READY','PICKED','CANCELLED')),
  pickup_code TEXT NOT NULL,
  merchant_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ready_at TEXT,
  picked_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_print_user ON print_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_print_merchant ON print_requests(merchant_id, status);

CREATE TABLE IF NOT EXISTS redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_tail TEXT NOT NULL,
  points INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REDEEMED','REVOKED')),
  issuer_id INTEGER NOT NULL REFERENCES users(id),
  issuer_role TEXT NOT NULL,
  scene_id INTEGER REFERENCES scenes(id),
  expires_at TEXT NOT NULL,
  redeemed_by INTEGER REFERENCES users(id),
  redeemed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codes_issuer ON redeem_codes(issuer_id, status);

CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  change INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  biz_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger(user_id, id);
`;

// 为已有数据库补充新增字段
const COLUMNS = [
  ['users', 'points', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'code_quota', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'merchant_name', "TEXT NOT NULL DEFAULT ''"],
  ['scenes', 'print_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['scenes', 'pickup_address', "TEXT NOT NULL DEFAULT ''"],
  ['templates', 'owner_id', 'INTEGER REFERENCES users(id)'],
  ['templates', 'code', 'TEXT'],
  ['templates', 'video_pipeline', "TEXT NOT NULL DEFAULT 'LOOP'"],
];

export const db = new DatabaseSync(process.env.DB_FILE || path.join(config.dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(SCHEMA);
db.exec(SCHEMA_V2);
for (const [table, column, def] of COLUMNS) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_code ON templates(code) WHERE code IS NOT NULL');

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
const norm = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export const one = (sql, ...p) => stmt(sql).get(...norm(p)) ?? null;
export const all = (sql, ...p) => stmt(sql).all(...norm(p));
export const run = (sql, ...p) => stmt(sql).run(...norm(p));
export const scalar = (sql, ...p) => {
  const row = one(sql, ...p);
  return row ? Object.values(row)[0] : null;
};

let depth = 0;
/** 同步事务（node:sqlite 为同步 API，fn 内不得 await） */
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export function getSetting(key, fallback = null) {
  const row = one('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
