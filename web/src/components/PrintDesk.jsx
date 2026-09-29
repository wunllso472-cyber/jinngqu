import { useState } from 'react';
import { get, post } from '../api.js';
import { PRINT_STATUS } from '../pages/Prints.jsx';
import { Empty, ErrorBox, Modal, Pager, Spinner, StatusBadge, Tabs, confirm, downloadFile, toast, useBusy, useLoad } from '../ui.jsx';

/** 打印履约：商户处理本景区申请，管理员可按景区查看 */
export default function PrintDesk({ sceneId }) {
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/print-staff', { status, page, sceneId }), [status, page, sceneId]);
  const [verifying, setVerifying] = useState(null);
  const [code, setCode] = useState('');
  const [busy, run] = useBusy();

  const ready = (p) =>
    run(async () => {
      if (!(await confirm({ title: '标记可取件', message: '确认已完成实际打印、照片可以领取？' }))) return;
      await post(`/print-staff/${p.id}/ready`);
      toast('已标记可取件', 'ok');
      reload();
    });
  const cancel = (p) =>
    run(async () => {
      if (!(await confirm({ title: '取消申请', message: `取消 ${p.user?.nickname} 的打印申请？`, danger: true }))) return;
      await post(`/prints/${p.id}/cancel`, { note: '商户取消' });
      toast('已取消');
      reload();
    });
  const pickup = () =>
    run(async () => {
      if (!/^\d{6}$/.test(code.trim())) return toast('请输入 6 位取件码', 'bad');
      await post(`/print-staff/${verifying.id}/pickup`, { code: code.trim() });
      toast('已核销，确认取件', 'ok');
      setVerifying(null);
      setCode('');
      reload();
    });

  return (
    <div className="stack">
      <div className="notice">只在现场具备打印与交付能力时开放申请。收到申请后，在这里下载原图，完成实际打印再标记可取件；游客到店出示取件码后核销。系统不会直接控制打印机。</div>
      <Tabs
        small
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        items={[
          { value: 'PENDING', label: '待处理' },
          { value: 'READY', label: '可取件' },
          { value: 'PICKED', label: '已取件' },
          { value: 'CANCELLED', label: '已取消' },
          { value: '', label: '全部' },
        ]}
      />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.list.length ? (
        <Empty text="暂无打印申请" />
      ) : (
        <div className="list">
          {data.list.map((p) => (
            <div key={p.id} className="list-item row" style={{ alignItems: 'flex-start' }}>
              {p.resultUrl ? <img className="thumb" src={p.resultUrl} alt="" /> : <img className="thumb" src={p.cover} alt="" />}
              <div className="grow stack" style={{ gap: 4 }}>
                <div className="row-between">
                  <span style={{ fontWeight: 650 }}>
                    凭证 #{p.id} · {p.paper} × {p.copies} 份
                  </span>
                  <StatusBadge map={PRINT_STATUS} status={p.status} />
                </div>
                <div className="small muted">
                  {p.user?.nickname}（用户 #{p.user?.id}）· {p.templateTitle} · 订单 {p.orderNo}
                </div>
                <div className="small muted">
                  {p.scene?.name} · 申请于 {p.createdAt.slice(5, 16)}
                  {p.readyAt && ` · 打印于 ${p.readyAt.slice(5, 16)}`}
                  {p.pickedAt && ` · 取件于 ${p.pickedAt.slice(5, 16)}`}
                </div>
                {p.note && <div className="small">游客备注：{p.note}</div>}
                <div className="row wrap">
                  {p.resultUrl && ['PENDING', 'READY'].includes(p.status) && (
                    <button className="btn btn-ghost btn-xs" onClick={() => downloadFile(p.resultUrl)}>
                      下载打印原图
                    </button>
                  )}
                  {p.status === 'PENDING' && (
                    <button className="btn btn-ok btn-xs" onClick={() => ready(p)} disabled={busy}>
                      已打印，标记可取件
                    </button>
                  )}
                  {p.status === 'READY' && (
                    <button className="btn btn-primary btn-xs" onClick={() => setVerifying(p)}>
                      核销并确认已取件
                    </button>
                  )}
                  {['PENDING', 'READY'].includes(p.status) && (
                    <button className="btn btn-danger btn-xs" onClick={() => cancel(p)} disabled={busy}>
                      取消
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}
      <Modal
        open={!!verifying}
        onClose={() => setVerifying(null)}
        title="核销取件"
        footer={
          <button className="btn btn-primary" onClick={pickup} disabled={busy}>
            核销
          </button>
        }
      >
        <div className="stack">
          <p className="small muted">请核对游客取件码，确认照片已交付。核销后不能重复取件。</p>
          <input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="输入游客出示的取件码" />
        </div>
      </Modal>
    </div>
  );
}
