import { useState } from 'react';
import { get, post, put } from '../../api.js';
import { ROLE_NAMES } from '../../format.js';
import { Badge, ErrorBox, Modal, Pager, Spinner, Tabs, toast, useBusy, useLoad } from '../../ui.jsx';

/** 给商户分配兑换码发放额度（积分点数） */
function QuotaGrant({ user, onDone }) {
  const [delta, setDelta] = useState('');
  const [busy, run] = useBusy();
  const grant = () =>
    run(async () => {
      const n = Number(delta);
      if (!Number.isInteger(n) || !n) return toast('请输入非零整数，负数为扣减', 'bad');
      const r = await post('/codes/quota', { userId: user.id, delta: n });
      toast(`发放额度已调整为 ${r.quota}`, 'ok');
      onDone();
    });
  return (
    <div className="card card-tight stack" style={{ gap: 8 }}>
      <div className="row-between">
        <span style={{ fontWeight: 650 }}>兑换码发放额度</span>
        <span className="gold">{user.codeQuota ?? 0} 积分</span>
      </div>
      <div className="row">
        <input className="input grow" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="±额度，如 1000" />
        <button className="btn btn-ghost btn-sm" onClick={grant} disabled={busy}>
          调整
        </button>
      </div>
    </div>
  );
}

function UserForm({ user, onClose, onSaved }) {
  const isNew = !user.id;
  const [f, setF] = useState({
    username: user.username || '',
    nickname: user.nickname || '',
    merchantName: user.merchantName || '',
    role: user.role || 'visitor',
    status: user.status || 'ENABLED',
    password: '',
  });
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () =>
    run(async () => {
      if (isNew) await post('/admin/users', f);
      else await put(`/admin/users/${user.id}`, { nickname: f.nickname, merchantName: f.merchantName, role: f.role, status: f.status, password: f.password || undefined });
      toast(isNew ? '账号已创建' : '权限已更新', 'ok');
      onSaved();
    });
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? '创建账号' : `账号权限 · 用户 #${user.id}`}
      footer={
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          保存
        </button>
      }
    >
      <div className="stack">
        <div className="field">
          <label>账号</label>
          <input className="input" value={f.username} onChange={set('username')} disabled={!isNew} placeholder="2–20 位字母、数字或下划线" />
        </div>
        <div className="field">
          <label>昵称</label>
          <input className="input" maxLength={20} value={f.nickname} onChange={set('nickname')} />
        </div>
        {!isNew && (
          <div className="field">
            <label>商户名称</label>
            <input className="input" maxLength={40} value={f.merchantName} onChange={set('merchantName')} placeholder="未设置商户名称" />
          </div>
        )}
        <div className="form-grid">
          <div className="field">
            <label>角色</label>
            <select className="select" value={f.role} onChange={set('role')}>
              {Object.entries(ROLE_NAMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {!isNew && (
            <div className="field">
              <label>状态</label>
              <select className="select" value={f.status} onChange={set('status')}>
                <option value="ENABLED">启用</option>
                <option value="DISABLED">停用</option>
              </select>
            </div>
          )}
        </div>
        <div className="field">
          <label>{isNew ? '密码' : '重置密码（留空不修改）'}</label>
          <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} placeholder="8–20 位，包含字母和数字" />
        </div>
        {!isNew && <p className="small muted">修改角色、停用或重置密码后，该账号需要重新登录。已绑定景区的商户须先解除绑定才能改为游客或停用。</p>}
        {!isNew && user.role === 'merchant' && <QuotaGrant user={user} onDone={onSaved} />}
      </div>
    </Modal>
  );
}

export default function UsersPanel() {
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const { data, error, loading, reload } = useLoad(() => get('/admin/users', { role, q: query, page }), [role, query, page]);

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h2 style={{ fontSize: 18 }}>账号权限</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
          ＋ 创建账号
        </button>
      </div>
      <div className="row wrap">
        <Tabs
          small
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          items={[{ value: '', label: '全部' }, ...Object.entries(ROLE_NAMES).map(([k, v]) => ({ value: k, label: v }))]}
        />
        <input
          className="input"
          style={{ maxWidth: 220, minHeight: 34, height: 34 }}
          placeholder="搜索用户ID或昵称"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (setQuery(q.trim()), setPage(1))}
        />
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>账号 / 昵称</th>
                  <th>角色</th>
                  <th>绑定景区</th>
                  <th className="num">成功作品</th>
                  <th className="num">积分 / 发放额度</th>
                  <th>状态</th>
                  <th>最近登录</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.list.map((u) => (
                  <tr key={u.id}>
                    <td>#{u.id}</td>
                    <td>
                      {u.username}
                      <div className="small muted">{u.merchantName || '未设置商户名称'}</div>
                    </td>
                    <td>
                      <Badge tone={u.role === 'admin' ? 'gold' : u.role === 'merchant' ? 'info' : 'mute'}>{ROLE_NAMES[u.role]}</Badge>
                    </td>
                    <td>{u.scene?.name || <span className="muted">-</span>}</td>
                    <td className="num">{u.orders}</td>
                    <td className="num">
                      {u.points}
                      {u.role === 'merchant' && <span className="muted small"> / {u.codeQuota}</span>}
                    </td>
                    <td>{u.status === 'ENABLED' ? <Badge tone="ok">启用</Badge> : <Badge tone="bad">已停用</Badge>}</td>
                    <td className="small">{u.lastLoginAt?.slice(5, 16) || '-'}</td>
                    <td>
                      <button className="btn btn-ghost btn-xs" onClick={() => setEditing(u)}>
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />
        </>
      )}
      {editing && (
        <UserForm
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
