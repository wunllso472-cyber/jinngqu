import { useState } from 'react';
import { get, post } from '../../api.js';
import { ORDER_STATUS, PURCHASE_STATUS, SERVICE_META, SERVICE_TYPES, WITHDRAW_STATUS, shortTime, yuan } from '../../format.js';
import { Empty, ErrorBox, Modal, Pager, Spinner, StatusBadge, Tabs, confirm, toast, useBusy, useLoad } from '../../ui.jsx';

export function OrdersPanel({ sceneId }) {
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/admin/orders', { sceneId, status, type, q: query, page }), [sceneId, status, type, query, page]);
  const reset = (fn) => (v) => (fn(v), setPage(1));
  return (
    <div className="stack">
      <div className="row wrap">
        <Tabs small value={status} onChange={reset(setStatus)} items={[{ value: '', label: '全部' }, ...['SUCCESS', 'PROCESSING', 'QUEUED', 'FAILED', 'PENDING', 'CANCELLED'].map((s) => ({ value: s, label: ORDER_STATUS[s].text.split(' · ')[0] }))]} />
      </div>
      <div className="row wrap">
        <Tabs small value={type} onChange={reset(setType)} items={[{ value: '', label: '全部服务' }, ...SERVICE_TYPES.map((t) => ({ value: t, label: SERVICE_META[t].short }))]} />
        <input className="input" style={{ maxWidth: 220, minHeight: 34, height: 34 }} placeholder="订单号 / 游客账号" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setQuery(q.trim()), setPage(1))} />
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.list.length ? (
        <Empty text="暂无记录" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>游客</th>
                  <th>景区 / 服务 / 模板</th>
                  <th className="num">金额</th>
                  <th className="num">标准成本</th>
                  <th>状态</th>
                  <th>提供方</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.list.map((o) => (
                  <tr key={o.id}>
                    <td className="small">{o.orderNo}</td>
                    <td>
                      {o.user?.username}
                      <div className="small muted">#{o.user?.id}</div>
                    </td>
                    <td>
                      {o.sceneName} · {o.serviceName}
                      <div className="small muted">{o.templateTitle}</div>
                    </td>
                    <td className="num">
                      {yuan(o.amount)}
                      {o.refundAmount > 0 && <div className="small bad">退 {yuan(o.refundAmount)}</div>}
                    </td>
                    <td className="num">{o.status === 'SUCCESS' ? yuan(o.unitCost) : <span className="muted small">未计入</span>}</td>
                    <td>
                      <StatusBadge map={ORDER_STATUS} status={o.status} />
                      {o.error && <div className="small muted" style={{ maxWidth: 220, whiteSpace: 'normal' }}>{o.error}</div>}
                    </td>
                    <td className="small">{o.provider || '-'}</td>
                    <td className="small">{shortTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}

export function PurchasesPanel({ sceneId }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/admin/purchases', { sceneId, page }), [sceneId, page]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data.list.length) return <Empty text="暂无额度购买记录" />;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>单号</th>
              <th>商户</th>
              <th>服务</th>
              <th className="num">次数</th>
              <th className="num">单价</th>
              <th className="num">金额</th>
              <th>状态</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {data.list.map((p) => (
              <tr key={p.id}>
                <td className="small">{p.purchaseNo}</td>
                <td>{p.merchant?.nickname || p.merchant?.username}</td>
                <td>{p.serviceName}</td>
                <td className="num">{p.count}</td>
                <td className="num">{yuan(p.unitPrice)}</td>
                <td className="num gold">{yuan(p.amount)}</td>
                <td>
                  <StatusBadge map={PURCHASE_STATUS} status={p.status} />
                </td>
                <td className="small">{shortTime(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />
    </>
  );
}

export function WithdrawalsPanel({ sceneId, onChange }) {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  const { data, error, loading, reload } = useLoad(() => get('/admin/withdrawals', { sceneId, status, page }), [sceneId, status, page]);
  const after = () => {
    reload();
    onChange?.();
  };

  const approve = (w) =>
    run(async () => {
      if (!(await confirm({ title: '审核通过', message: `确认通过 ${w.merchant?.nickname} 的提现申请 ${yuan(w.amount)}？通过后可执行模拟打款。` }))) return;
      await post(`/admin/withdrawals/${w.id}/approve`, { note: '' });
      toast('已审核通过，待模拟打款', 'ok');
      after();
    });
  const pay = (w) =>
    run(async () => {
      if (!(await confirm({ title: '确认模拟打款', message: `仅记录模拟打款 ${yuan(w.amount)}，不会真实到账。` }))) return;
      await post(`/admin/withdrawals/${w.id}/pay`);
      toast('已模拟打款', 'ok');
      after();
    });
  const reject = () =>
    run(async () => {
      if (!note.trim()) return toast('请先填写驳回原因', 'bad');
      await post(`/admin/withdrawals/${rejecting.id}/reject`, { note });
      toast('已驳回，冻结金额已释放');
      setRejecting(null);
      setNote('');
      after();
    });

  return (
    <div className="stack">
      <Tabs
        small
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        items={[
          { value: 'open', label: '待审核 / 待打款' },
          { value: 'PAID', label: '已打款' },
          { value: 'REJECTED', label: '已驳回' },
          { value: 'CANCELLED', label: '已撤销' },
          { value: '', label: '全部' },
        ]}
      />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.list.length ? (
        <Empty text="暂无提现申请" />
      ) : (
        <div className="list">
          {data.list.map((w) => (
            <div key={w.id} className="list-item stack" style={{ gap: 6 }}>
              <div className="row-between wrap">
                <span style={{ fontWeight: 650 }}>
                  提现 #{w.id} · <span className="gold">{yuan(w.amount)}</span>
                </span>
                <StatusBadge map={WITHDRAW_STATUS} status={w.status} />
              </div>
              <div className="small muted">
                {w.scene?.name || '-'} · 商户 {w.merchant?.nickname}（#{w.merchant?.id}）· {w.withdrawalNo} · 申请于 {shortTime(w.createdAt)}
              </div>
              <div className="small muted">
                商户当前：可提现 {yuan(w.wallet.available)} · 冻结 {yuan(w.wallet.frozen)} · 累计打款 {yuan(w.wallet.withdrawn)} · 游客成功消费 {yuan(w.wallet.income)}
              </div>
              {w.note && <div className="small">申请备注：{w.note}</div>}
              {w.reviewNote && <div className="small">审核备注：{w.reviewNote}</div>}
              <div className="row wrap">
                {w.status === 'REQUESTED' && (
                  <button className="btn btn-ok btn-sm" onClick={() => approve(w)} disabled={busy}>
                    审核通过
                  </button>
                )}
                {w.status === 'APPROVED' && (
                  <button className="btn btn-primary btn-sm" onClick={() => pay(w)} disabled={busy}>
                    模拟打款
                  </button>
                )}
                {['REQUESTED', 'APPROVED'].includes(w.status) && (
                  <button className="btn btn-danger btn-sm" onClick={() => setRejecting(w)} disabled={busy}>
                    驳回
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}
      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="驳回提现申请"
        footer={
          <button className="btn btn-danger" onClick={reject} disabled={busy}>
            确认驳回
          </button>
        }
      >
        <div className="stack">
          <p className="small muted">驳回后冻结金额将释放回商户的可提现余额。</p>
          <textarea className="textarea" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="驳回原因（必填）" />
        </div>
      </Modal>
    </div>
  );
}
