import { useState } from 'react';
import { get, post } from '../api.js';
import { useApp } from '../ctx.jsx';
import { CODE_STATUS, shortTime } from '../format.js';
import { Empty, ErrorBox, Modal, Pager, Spinner, StatusBadge, Tabs, confirm, toast, useBusy, useLoad } from '../ui.jsx';

/** 兑换码：批量生成（明文只显示一次）、列表、撤销 */
export default function CodesPanel({ sceneId }) {
  const { user, refresh } = useApp();
  const isAdmin = user?.role === 'admin';
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/codes', { status, page, sceneId }), [status, page, sceneId]);
  const [form, setForm] = useState({ count: '10', points: '100', days: '30' });
  const [generated, setGenerated] = useState(null);
  const [busy, run] = useBusy();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, '') }));

  const generate = () =>
    run(async () => {
      const c = Number(form.count);
      const p = Number(form.points);
      const d = Number(form.days);
      if (!(c >= 1 && c <= 100 && p >= 1 && p <= 10000 && d >= 1 && d <= 365)) return toast('数量1–100，积分1–10000，有效期1–365天', 'bad');
      const tip = isAdmin ? '管理员发放将记录操作日志。' : `将占用 ${c * p} 点发放额度。`;
      if (!(await confirm({ title: '生成兑换码', message: `生成 ${c} 个，每个 ${p} 积分，有效 ${d} 天。${tip}` }))) return;
      const r = await post('/codes', { count: c, points: p, days: d });
      setGenerated(r);
      reload();
      refresh();
    });
  const revoke = (x) =>
    run(async () => {
      if (!(await confirm({ title: '撤销兑换码', message: '未使用的兑换码将失效，商户发行时占用的额度将退回。', danger: true }))) return;
      await post(`/codes/${x.id}/revoke`);
      toast('已撤销');
      reload();
      refresh();
    });
  const copyAll = () =>
    navigator.clipboard?.writeText(generated.codes.join('\n')).then(
      () => toast('已复制', 'ok'),
      () => toast('复制失败，请手动复制', 'bad'),
    );

  return (
    <div className="stack">
      <div className="card stack">
        <h3>批量生成兑换码</h3>
        <p className="small muted">
          {isAdmin ? '管理员发放会写入审计日志' : `剩余发放额度：${data?.quota ?? '-'} 积分`}。兑换码一次有效，过期码可撤销退回额度。
        </p>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="field">
            <label>数量（1–100）</label>
            <input className="input" inputMode="numeric" value={form.count} onChange={set('count')} />
          </div>
          <div className="field">
            <label>每码积分</label>
            <input className="input" inputMode="numeric" value={form.points} onChange={set('points')} />
          </div>
          <div className="field">
            <label>有效天数（1–365）</label>
            <input className="input" inputMode="numeric" value={form.days} onChange={set('days')} />
          </div>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          生成兑换码
        </button>
      </div>

      <Tabs
        small
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        items={[{ value: '', label: '全部' }, ...Object.entries(CODE_STATUS).map(([k, { text }]) => ({ value: k, label: text }))]}
      />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.list.length ? (
        <Empty text="暂无记录" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>兑换码</th>
                <th className="num">积分</th>
                <th>状态</th>
                <th>批次</th>
                {isAdmin && <th>发行者</th>}
                <th>兑换</th>
                <th>有效期至</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.list.map((x) => (
                <tr key={x.id}>
                  <td className="small">****-{x.tail}</td>
                  <td className="num">{x.points}</td>
                  <td>
                    <StatusBadge map={CODE_STATUS} status={x.status} />
                  </td>
                  <td className="small muted">{x.batchNo}</td>
                  {isAdmin && <td className="small">发行者 #{x.issuer?.id}</td>}
                  <td className="small">{x.redeemedBy ? `用户 #${x.redeemedBy.id} · ${shortTime(x.redeemedAt)}` : '-'}</td>
                  <td className="small">{x.expiresAt.slice(0, 16)}</td>
                  <td>
                    {['ACTIVE', 'EXPIRED'].includes(x.status) && (
                      <button className="btn btn-ghost btn-xs" onClick={() => revoke(x)} disabled={busy}>
                        撤销并退回发行额度
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}

      <Modal
        open={!!generated}
        title="兑换码已生成"
        onClose={async () => {
          if (await confirm({ title: '已保存兑换码？', message: '关闭后不能再次查询明文，请先复制并妥善保存。', okText: '已保存，关闭' })) setGenerated(null);
        }}
        footer={
          <button className="btn btn-primary" onClick={copyAll}>
            复制全部兑换码
          </button>
        }
      >
        {generated && (
          <div className="stack">
            <p className="small muted">
              批次 {generated.batchNo} · {generated.count} 个 · 每个 {generated.points} 积分 · 有效 {generated.days} 天
            </p>
            <div className="notice notice-bad">完整兑换码只显示一次。请复制保存，不要发送给无关人员。</div>
            <div className="code-list">{generated.codes.join('\n')}</div>
          </div>
        )}
      </Modal>
    </div>
  );
}
