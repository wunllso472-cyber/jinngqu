import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { ORDER_STATUS, yuan } from '../format.js';
import { ErrorBox, Header, Spinner, StatusBadge, downloadFile, toast, useBusy, useLoad } from '../ui.jsx';
import { PrintApply } from './Prints.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: o, error, reload, setData } = useLoad(() => get(`/orders/${id}`), [id]);
  const [busy, run] = useBusy();
  const active = o && ['QUEUED', 'PROCESSING'].includes(o.status);

  // 制作中每 2 秒刷新一次进度
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        const next = await get(`/orders/${id}`);
        setData(next);
        if (next.status === 'SUCCESS') toast(next.resultKind === 'video' ? '视频制作完成，可以下载了' : '制作完成', 'ok');
        if (next.status === 'FAILED') toast('制作失败，已自动模拟退款', 'bad');
      } catch {
        /* 下次再试 */
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, id]);

  if (error) return (<><Header title="订单详情" /><ErrorBox error={error} onRetry={reload} /></>);
  if (!o) return (<><Header title="订单详情" /><Spinner /></>);

  const pay = () =>
    run(async () => {
      setData(await post(`/orders/${o.id}/pay`));
      toast('模拟支付成功', 'ok');
    });
  const cancel = () =>
    run(async () => {
      setData(await post(`/orders/${o.id}/cancel`));
      toast('已取消');
    });

  return (
    <div>
      <Header title="订单详情" />
      <div className="section stack">
        {o.status === 'SUCCESS' && o.resultUrl ? (
          <div className="card card-tight">
            {o.resultKind === 'video' ? (
              <video src={o.resultUrl} controls playsInline style={{ width: '100%', borderRadius: 10 }} />
            ) : (
              <img src={o.resultUrl} alt="作品" style={{ width: '100%', borderRadius: 10 }} />
            )}
            <p className="small muted mt">作品由 AI 生成，细节可能存在偏差；传播时请保留 AI 生成标识。</p>
            <button className="btn btn-primary btn-block mt" onClick={() => downloadFile(o.resultUrl)}>
              {o.resultKind === 'video' ? '保存视频' : '保存图片'}
            </button>
          </div>
        ) : active ? (
          <div className="card stack" style={{ textAlign: 'center' }}>
            <span className="spinner" style={{ margin: '8px auto' }} />
            <h3>AI 正在制作中</h3>
            <div className="progress">
              <div style={{ width: `${o.progress}%` }} />
            </div>
            <p className="small muted">
              {o.stage || '排队中'} · {o.progress}%
            </p>
            <p className="small muted">可离开页面，在“我的作品”中查看结果。</p>
          </div>
        ) : o.status === 'FAILED' ? (
          <div className="card stack">
            <h3 className="bad">制作失败 · 已模拟退款</h3>
            <p className="small muted">{o.error}</p>
            <p className="small">已退回 {yuan(o.refundAmount)}，景区服务次数已回补。</p>
            <button className="btn btn-ghost" onClick={() => nav(`/create/${o.templateId}`)}>
              重新选择人物并制作
            </button>
          </div>
        ) : o.status === 'PENDING' ? (
          <div className="card stack">
            <h3>待支付</h3>
            <div className="row">
              <button className="btn btn-ghost grow" onClick={cancel} disabled={busy}>
                取消订单
              </button>
              <button className="btn btn-primary grow" onClick={pay} disabled={busy}>
                模拟支付 {yuan(o.amount)}
              </button>
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="row-between">
            <h3>{o.templateTitle}</h3>
            <StatusBadge map={ORDER_STATUS} status={o.status} />
          </div>
          <div className="divider" />
          <div className="kv">
            <span>订单号</span>
            <span className="small">{o.orderNo}</span>
            <span>服务</span>
            <span>{o.serviceName}</span>
            <span>景区</span>
            <span>{o.sceneName}</span>
            <span>人物</span>
            <span>{o.character?.name || '-'}</span>
            <span>金额</span>
            <span className="gold">{yuan(o.amount)}（模拟支付）</span>
            {o.refundAmount > 0 && (
              <>
                <span>模拟退款</span>
                <span>{yuan(o.refundAmount)}</span>
              </>
            )}
            <span>创建时间</span>
            <span>{o.createdAt}</span>
            {o.paidAt && (
              <>
                <span>支付时间</span>
                <span>{o.paidAt}</span>
              </>
            )}
            {o.finishedAt && (
              <>
                <span>完成时间</span>
                <span>{o.finishedAt}</span>
              </>
            )}
          </div>
        </div>
        {o.status === 'SUCCESS' && o.resultKind === 'image' && <PrintApply orderId={o.id} />}
        <button className="btn btn-ghost" onClick={() => nav(`/template/${o.templateId}`)}>
          再做一次
        </button>
        <button className="btn btn-ghost" onClick={() => nav('/tickets/new', { state: { orderId: o.id, orderNo: o.orderNo } })}>
          联系订单客服
        </button>
      </div>
    </div>
  );
}
