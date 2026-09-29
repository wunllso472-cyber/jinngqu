import { useState } from 'react';
import { get, post } from '../api.js';
import { useApp } from '../ctx.jsx';
import { Empty, ErrorBox, Header, Pager, Spinner, toast, useBusy, useLoad } from '../ui.jsx';

const BIZ = { REDEEM: '兑换码入账', CHECKIN_CONSUME: '制作扣除', ADMIN: '管理员调整' };

export default function Points() {
  const { refresh } = useApp();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/points', { page }), [page]);
  const [code, setCode] = useState('');
  const [busy, run] = useBusy();

  const redeem = () =>
    run(async () => {
      if (!code.trim()) return toast('请输入兑换码', 'bad');
      const r = await post('/points/redeem', { code });
      toast(r.replayed ? '已兑换过' : `兑换成功，已增加 ${r.points} 积分`, 'ok');
      setCode('');
      reload();
      refresh();
    });

  return (
    <div>
      <Header title="消费记录" />
      <div className="section stack">
        <div className="card stack">
          <div className="row-between">
            <span className="muted">当前积分</span>
            <span className="quota-num gold">{data?.balance ?? '-'}</span>
          </div>
          <div className="field">
            <label>兑换积分</label>
            <div className="row">
              <input className="input grow" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="粘贴完整兑换码" autoComplete="off" />
              <button className="btn btn-primary btn-sm" onClick={redeem} disabled={busy}>
                确认兑换
              </button>
            </div>
          </div>
          <p className="small muted">使用景区商户提供的兑换码，每个码仅限兑换一次。当前服务按次使用、无需充值；兑换积分不代表发生在线付款。</p>
        </div>
        <h3>积分明细</h3>
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data.list.length ? (
          <Empty text="暂无积分流水" />
        ) : (
          <div className="list">
            {data.list.map((l) => (
              <div key={l.id} className="list-item row-between">
                <div>
                  <div>{l.description}</div>
                  <div className="small muted">
                    {BIZ[l.biz_type] || l.biz_type} · {l.created_at}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={l.change > 0 ? 'ok' : 'bad'}>
                    {l.change > 0 ? '+' : ''}
                    {l.change} 积分
                  </div>
                  <div className="small muted">余额 {l.balance}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}
      </div>
    </div>
  );
}
