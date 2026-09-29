import { useState } from 'react';
import { yuan } from '../format.js';
import { ErrorBox, Spinner, Stat, Tabs, useLoad } from '../ui.jsx';
import { TrendBars } from './charts.jsx';

/** 模板使用情况：商户与管理员共用 */
export default function UsageTable({ load, showCost = false }) {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useLoad(() => load(days), [days]);
  return (
    <div className="stack">
      <Tabs
        small
        value={days}
        onChange={setDays}
        items={[
          { value: 7, label: '近7天' },
          { value: 30, label: '近30天' },
          { value: 90, label: '近90天' },
          { value: 0, label: '全部' },
        ]}
      />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <>
          <div className="stats">
            <Stat label="成功制作" value={data.totals.success} />
            <Stat label="失败制作（已退款）" value={data.totals.failed} />
            <Stat label="模拟消费金额" value={yuan(data.totals.revenue)} tone="gold" />
            {showCost && <Stat label="成功制作标准成本" value={yuan(data.totals.cost)} />}
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>每日趋势</h3>
            <TrendBars trend={data.trend} days={days} />
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>模板</th>
                  <th>类型</th>
                  <th className="num">成功</th>
                  <th className="num">失败</th>
                  <th className="num">制作中</th>
                  <th className="num">收入</th>
                  {showCost && <th className="num">标准成本</th>}
                  <th className="num">点赞</th>
                  <th className="num">收藏</th>
                </tr>
              </thead>
              <tbody>
                {data.templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="row">
                        <img className="thumb" src={t.cover} alt="" style={{ width: 32, height: 42 }} />
                        <span>{t.title}</span>
                        {t.status !== 'ON' && <span className="badge badge-mute">已下架</span>}
                      </div>
                    </td>
                    <td>{t.serviceName}</td>
                    <td className="num">{t.success}</td>
                    <td className="num">{t.failed}</td>
                    <td className="num">{t.processing}</td>
                    <td className="num gold">{yuan(t.revenue)}</td>
                    {showCost && <td className="num">{yuan(t.cost)}</td>}
                    <td className="num">{t.likes}</td>
                    <td className="num">{t.favorites}</td>
                  </tr>
                ))}
                {!data.templates.length && (
                  <tr>
                    <td colSpan={9} className="muted">
                      尚无模板
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="small muted">统计来自真实制作记录；失败订单已自动模拟退款，不计入收入。</p>
        </>
      )}
    </div>
  );
}
