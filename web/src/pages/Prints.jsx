import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put } from '../api.js';
import { PRINT_STATUS, shortTime } from '../format.js';
import { Empty, ErrorBox, Header, Pager, Spinner, StatusBadge, Tabs, confirm, toast, useBusy, useLoad } from '../ui.jsx';

/** 订单详情中的打印申请区块 */
export function PrintApply({ orderId }) {
  const nav = useNavigate();
  const { data, reload } = useLoad(() => get(`/prints/order/${orderId}`), [orderId]);
  const [paper, setPaper] = useState('6寸');
  const [copies, setCopies] = useState('1');
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  if (!data || !data.printable) return null;

  const apply = () =>
    run(async () => {
      const n = Number(copies);
      if (!Number.isInteger(n) || n < 1 || n > 10) return toast('打印份数应为 1–10', 'bad');
      if (!(await confirm({ title: '提交打印申请', message: '商户将按申请现场处理，具体费用与取件时间请联系商户确认。应用不会发起付款或扣除积分。' }))) return;
      const p = await post('/prints', { orderId, paper, copies: n, note });
      toast('已保存，可现场打印', 'ok');
      nav(`/prints/${p.id}`);
    });

  if (data.current) {
    return (
      <div className="card stack">
        <div className="row-between">
          <h3>打印凭证</h3>
          <StatusBadge map={PRINT_STATUS} status={data.current.status} />
        </div>
        <p className="small muted">
          {data.current.paper} × {data.current.copies} 份 · 取件地点：{data.current.scene?.pickupAddress || '-'}
        </p>
        <button className="btn btn-ghost" onClick={() => nav(`/prints/${data.current.id}`)}>
          查看取件码
        </button>
      </div>
    );
  }
  if (!data.printEnabled) {
    return <div className="notice">商户尚未开放打印申请</div>;
  }
  return (
    <div className="card stack">
      <h3>填写现场打印需求</h3>
      <p className="small muted">取件地点：{data.pickupAddress}</p>
      <div className="field">
        <span className="field-label">纸张规格</span>
        <Tabs small value={paper} onChange={setPaper} items={data.papers.map((p) => ({ value: p, label: p }))} />
      </div>
      <div className="field">
        <label>打印份数（1–10）</label>
        <input className="input" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="field">
        <label>备注</label>
        <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填" />
      </div>
      <button className="btn btn-primary" onClick={apply} disabled={busy}>
        申请打印凭证
      </button>
      {data.phone && (
        <a className="btn btn-ghost" href={`tel:${data.phone}`}>
          拨打商户电话
        </a>
      )}
    </div>
  );
}

export function PrintList() {
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/prints', { status, page }), [status, page]);
  return (
    <div>
      <Header title="打印凭证" />
      <div className="section stack">
        <Tabs
          small
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          items={[
            { value: '', label: '全部' },
            { value: 'PENDING', label: '待处理' },
            { value: 'READY', label: '可取件' },
            { value: 'PICKED', label: '已取件' },
            { value: 'CANCELLED', label: '已取消' },
          ]}
        />
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data.list.length ? (
          <Empty text="暂无打印申请">
            <p className="small muted">在已完成的照片订单详情中选择“申请打印”</p>
          </Empty>
        ) : (
          <div className="list">
            {data.list.map((p) => (
              <button key={p.id} className="list-item row" style={{ textAlign: 'left' }} onClick={() => nav(`/prints/${p.id}`)}>
                <img className="thumb" src={p.cover} alt="" />
                <div className="grow">
                  <div className="row-between">
                    <span className="ellipsis" style={{ fontWeight: 600 }}>
                      凭证 #{p.id} · {p.templateTitle}
                    </span>
                    <StatusBadge map={PRINT_STATUS} status={p.status} />
                  </div>
                  <div className="small muted">
                    {p.paper} × {p.copies} 份 · {p.scene?.name} · {shortTime(p.createdAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}
      </div>
    </div>
  );
}

export function PrintDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: p, error, reload, setData } = useLoad(() => get(`/prints/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, run] = useBusy();
  if (error) return (<><Header title="打印凭证" /><ErrorBox error={error} onRetry={reload} /></>);
  if (!p) return (<><Header title="打印凭证" /><Spinner /></>);

  const cancel = () =>
    run(async () => {
      if (!(await confirm({ title: '取消申请', message: '确定取消本次打印申请？', danger: true }))) return;
      setData(await post(`/prints/${p.id}/cancel`));
      toast('已取消');
    });
  const save = () =>
    run(async () => {
      setData(await put(`/prints/${p.id}`, form));
      setEditing(false);
      toast('已更新', 'ok');
    });

  return (
    <div>
      <Header title="打印凭证" />
      <div className="section stack">
        <div className="card stack" style={{ textAlign: 'center' }}>
          <StatusBadge map={PRINT_STATUS} status={p.status} />
          {['PENDING', 'READY'].includes(p.status) ? (
            <>
              <p className="small muted">请到店出示此取件码</p>
              <div className="pickup-code">{p.pickupCode}</div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => navigator.clipboard?.writeText(p.pickupCode).then(() => toast('已复制'), () => toast('复制失败，请手动复制', 'bad'))}
              >
                复制取件码
              </button>
            </>
          ) : (
            <p className="muted">{p.status === 'PICKED' ? `已于 ${p.pickedAt} 取件` : '申请已取消'}</p>
          )}
        </div>
        <div className="card">
          <div className="kv">
            <span>凭证号</span>
            <span className="small">{p.requestNo}</span>
            <span>作品</span>
            <span>{p.templateTitle}</span>
            <span>纸张 / 份数</span>
            <span>
              {p.paper} × {p.copies}
            </span>
            <span>取件地点</span>
            <span>{p.scene?.pickupAddress || '-'}</span>
            {p.note && (
              <>
                <span>备注</span>
                <span>{p.note}</span>
              </>
            )}
            {p.merchantNote && (
              <>
                <span>商户备注</span>
                <span>{p.merchantNote}</span>
              </>
            )}
            <span>申请时间</span>
            <span>{p.createdAt}</span>
          </div>
        </div>
        {editing && form && (
          <div className="card stack">
            <Tabs small value={form.paper} onChange={(v) => setForm({ ...form, paper: v })} items={['6寸', '7寸'].map((x) => ({ value: x, label: x }))} />
            <input className="input" inputMode="numeric" value={form.copies} onChange={(e) => setForm({ ...form, copies: e.target.value.replace(/\D/g, '') })} />
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注" />
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              更新打印凭证
            </button>
          </div>
        )}
        {p.status === 'PENDING' && !editing && (
          <button className="btn btn-ghost" onClick={() => (setForm({ paper: p.paper, copies: String(p.copies), note: p.note }), setEditing(true))}>
            修改申请
          </button>
        )}
        {['PENDING', 'READY'].includes(p.status) && (
          <button className="btn btn-danger" onClick={cancel} disabled={busy}>
            取消申请
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => nav(`/orders/${p.orderId}`)}>
          查看订单
        </button>
        {p.scene?.phone && (
          <a className="btn btn-ghost" href={`tel:${p.scene.phone}`}>
            拨打商户电话
          </a>
        )}
      </div>
    </div>
  );
}
