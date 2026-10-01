import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../api.js';
import { ORDER_STATUS, shortTime, yuan } from '../format.js';
import { Empty, ErrorBox, Header, Pager, Spinner, StatusBadge, Tabs, useLoad } from '../ui.jsx';

export default function Orders() {
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/orders', { status, page }), [status, page]);

  return (
    <div>
      <Header title="消费订单" />
      <div className="section">
        <Tabs
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          items={[
            { value: '', label: '全部' },
            { value: 'active', label: '进行中' },
            { value: 'SUCCESS', label: '已完成' },
            { value: 'FAILED', label: '已退款' },
          ]}
        />
        {data?.summary && (
          <p className="small muted mt">
            累计模拟消费 {yuan(data.summary.spent)} · 模拟退款 {yuan(data.summary.refunded)}（均未发生实际扣款）
          </p>
        )}
        <div className="list mt">
          {loading && !data ? (
            <Spinner />
          ) : error ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : !data.list.length ? (
            <Empty text="还没有消费订单，去首页挑一个模板吧" />
          ) : (
            data.list.map((o) => (
              <button key={o.id} className="list-item row" style={{ textAlign: 'left' }} onClick={() => nav(`/orders/${o.id}`)}>
                <img className="thumb" src={o.templateCover} alt="" />
                <div className="grow">
                  <div className="row-between">
                    <span className="ellipsis" style={{ fontWeight: 600 }}>
                      {o.templateTitle}
                    </span>
                    <span className="gold">{yuan(o.amount)}</span>
                  </div>
                  <div className="small muted">
                    {o.serviceName} · {o.sceneName} · {shortTime(o.createdAt)}
                  </div>
                  <div className="row mt" style={{ marginTop: 6 }}>
                    <StatusBadge map={ORDER_STATUS} status={o.status} />
                    {['QUEUED', 'PROCESSING'].includes(o.status) && <span className="small muted">{o.progress}%</span>}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}
      </div>
    </div>
  );
}
