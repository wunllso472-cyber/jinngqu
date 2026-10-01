import { useState } from 'react';
import { get } from '../api.js';
import { QUOTA_REASON, shortTime } from '../format.js';
import { Pager, useLoad } from '../ui.jsx';

/** 景区额度变动明细；version 变化时重新加载 */
export default function QuotaLogTable({ path, size = 10, version = 0 }) {
  const [page, setPage] = useState(1);
  const { data } = useLoad(() => get(path, { page, size }), [path, page, version]);
  if (!data) return null;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>服务</th>
              <th>类型</th>
              <th className="num">变动</th>
              <th className="num">余额</th>
              <th>关联</th>
            </tr>
          </thead>
          <tbody>
            {data.list.map((l) => (
              <tr key={l.id}>
                <td className="small">{shortTime(l.created_at)}</td>
                <td>{l.serviceName}</td>
                <td>{QUOTA_REASON[l.reason] || l.reason}</td>
                <td className={`num ${l.delta > 0 ? 'ok' : 'bad'}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                <td className="num">{l.balance}</td>
                <td className="small muted">{l.ref}</td>
              </tr>
            ))}
            {!data.list.length && (
              <tr>
                <td colSpan={6} className="muted">
                  暂无记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />
    </>
  );
}
